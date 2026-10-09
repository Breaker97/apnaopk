import { Types, type ClientSession } from "mongoose";
import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { PREORDER_ITEM_STATUS, PURCHASE_TYPE } from "@/lib/orders/preorders";
import { deriveOrderStatusFromSubOrders } from "@/lib/orders/order-status-apply";
import { DISPATCHED_ORDER_STATUSES } from "@/lib/orders/order-status-workflow";
import {
  releaseConsignmentQuotaInSession,
  restoreAllocationsInSession,
  restoreLegacyConsignmentsInSession,
  runAllocationAftermath,
} from "@/lib/orders/preorder-allocation";
import {
  cancellationEffects,
  insertOperationInSession,
  runPreorderOperation,
} from "@/lib/orders/preorder-operations";
import { isActiveCollection } from "@/lib/orders/preorder-scope";
import {
  runTransaction,
  TransactionContendedError,
  TransactionOutcomeUnknownError,
  TransactionsUnavailableError,
} from "@/lib/db-transaction";
import { PreorderOperation } from "@/models/preorder-operation.model";
import type { AuditContext } from "@/lib/audit";
import { auditPreorderMove } from "@/lib/orders/audit-preorder";

/**
 * Calling off pre-order consignments — the one transition every cancellation
 * of a pre-order shares: an admin's, a seller's, and the expiry.
 *
 * One transaction: the chosen consignments become cancelled and their
 * pre-order lines say why (`cancelled` or `expired`); the parent's status is
 * derived from what survives — a dispatched sibling keeps the order shipped;
 * the stock an allocation took goes back from its evidence; the reservation
 * places still held are freed; an open balance request is voided; and a
 * {@link PreorderOperation} records the rest — labels, coupon, write-off, a
 * refund of exactly this scope, the shopper's message — for the worker to
 * carry out and resume after any crash.
 */

export type CancelScopeResult = {
  operationId: string;
  orderNumber: string;
  wholeOrder: boolean;
  from: string;
  to: string;
  preorderFrom?: string;
  preorderTo?: string;
  /** The consignment's own status before, when exactly one was cancelled. */
  consignmentFrom?: string;
  subOrderIds: string[];
  aftermath: Parameters<typeof runAllocationAftermath>[0];
};

type CancellableOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  status?: string;
  preorderStatus?: string;
  preorderCollection?: { cycleId?: string; state?: string } | null;
  preorderRelease?: { state?: string } | null;
  subOrders?: Array<{
    _id: Types.ObjectId;
    vendorId?: unknown;
    status?: string;
    items?: Array<{ purchaseType?: string; preorderStatus?: string }>;
  }>;
};

export class CancellationRefused extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Cancellation refused: ${reason}`);
    this.name = "CancellationRefused";
    this.reason = reason;
  }
}

/**
 * The status a parent pre-order reads once `ended` consignments are gone:
 * `ended` only when no live pre-order line is left, otherwise what the
 * survivors say.
 */
export function parentPreorderStatusAfter(
  subOrders: Array<{ status?: string; items?: Array<{ purchaseType?: string; preorderStatus?: string }> }>,
  ended: string,
  current?: string,
): string {
  const surviving = subOrders
    .filter((sub) => sub.status !== ORDER_STATUS.CANCELLED)
    .flatMap((sub) => sub.items || [])
    .filter((item) => item?.purchaseType === PURCHASE_TYPE.PREORDER)
    .map((item) => String(item.preorderStatus || ""));
  if (surviving.length === 0) return ended;
  if (surviving.every((status) => status === PREORDER_ITEM_STATUS.FULFILLED)) {
    return PREORDER_ITEM_STATUS.FULFILLED;
  }
  if (
    surviving.every(
      (status) =>
        status === PREORDER_ITEM_STATUS.READY || status === PREORDER_ITEM_STATUS.FULFILLED,
    )
  ) {
    return PREORDER_ITEM_STATUS.READY;
  }
  return current && current !== PREORDER_ITEM_STATUS.PAYMENT_DUE ? current : PREORDER_ITEM_STATUS.RESERVED;
}

/**
 * Cancel `scopeIds` inside the caller's transaction, after the caller has
 * checked whatever makes this cancellation legitimate (a deadline, a
 * permission). Refuses a consignment that has shipped — goods that left are a
 * return, never a cancellation.
 */
export async function cancelScopeInSession(params: {
  session: ClientSession;
  order: CancellableOrder;
  scopeIds: string[];
  ended: "cancelled" | "expired";
  kind: "cancel" | "expire";
  operationKey: string;
  actor: string;
  actorRole?: string;
  actorEmail?: string;
  source: string;
  reasonCode: string;
  reason: string;
  cancelReason: string;
  notifyCustomer?: boolean;
  now: Date;
}): Promise<CancelScopeResult> {
  const { session, order, now } = params;
  const wanted = new Set(params.scopeIds.map(String));
  const scope = (order.subOrders || []).filter((sub) => wanted.has(String(sub._id)));
  if (scope.length === 0) throw new CancellationRefused("nothing_to_cancel");
  if (scope.some((sub) => sub.status === ORDER_STATUS.CANCELLED)) {
    throw new CancellationRefused("already_cancelled");
  }
  if (scope.some((sub) => DISPATCHED_ORDER_STATUSES.includes(String(sub.status || "")))) {
    throw new CancellationRefused("dispatched");
  }
  const endedItem =
    params.ended === "expired" ? PREORDER_ITEM_STATUS.EXPIRED : PREORDER_ITEM_STATUS.CANCELLED;
  const after = (order.subOrders || []).map((sub) =>
    wanted.has(String(sub._id))
      ? {
          ...sub,
          status: ORDER_STATUS.CANCELLED,
          items: (sub.items || []).map((item) =>
            item?.purchaseType === PURCHASE_TYPE.PREORDER
              ? { ...item, preorderStatus: endedItem }
              : item,
          ),
        }
      : sub,
  );
  const derived =
    deriveOrderStatusFromSubOrders(after) || order.status || ORDER_STATUS.CANCELLED;
  const wholeOrder = derived === ORDER_STATUS.CANCELLED;
  const preorderTo = parentPreorderStatusAfter(after, endedItem, order.preorderStatus);
  const set: Record<string, unknown> = {
    status: derived,
    preorderStatus: preorderTo,
    statusChangedBy: params.actor,
    "items.$[endedLine].preorderStatus": endedItem,
  };
  const arrayFilters: Record<string, unknown>[] = [
    {
      "endedLine.purchaseType": PURCHASE_TYPE.PREORDER,
      "endedLine.vendorId": { $in: scope.map((sub) => sub.vendorId) },
    },
    { "endedPreorderLine.purchaseType": PURCHASE_TYPE.PREORDER },
  ];
  scope.forEach((sub, index) => {
    set[`subOrders.$[end${index}].status`] = ORDER_STATUS.CANCELLED;
    set[`subOrders.$[end${index}].items.$[endedPreorderLine].preorderStatus`] = endedItem;
    arrayFilters.push({
      [`end${index}._id`]: sub._id,
      [`end${index}.status`]: sub.status,
    });
  });
  if (wholeOrder) {
    set.cancelledAt = now;
    set.cancelReason = params.cancelReason;
  }
  // Any balance request stands for a scope that no longer exists.
  if (isActiveCollection(order.preorderCollection)) {
    set["preorderCollection.state"] = "void";
    set["preorderCollection.voidedAt"] = now;
    set["preorderCollection.voidReason"] = params.ended;
  }
  // A paid release that was waiting on these goods has nothing to release.
  if (
    wholeOrder &&
    (order.preorderRelease?.state === "requested" || order.preorderRelease?.state === "waiting")
  ) {
    set["preorderRelease.state"] = "superseded";
    set["preorderRelease.reason"] = "order_cancelled";
  }
  const written = await Order.updateOne(
    { _id: order._id, status: order.status },
    { $set: set },
    { session, arrayFilters },
  );
  if (written.matchedCount !== 1) throw new TransactionContendedError("Cancel pre-order");

  const subOrderIds = scope.map((sub) => String(sub._id));
  const restored = await restoreAllocationsInSession({
    session,
    orderId: String(order._id),
    subOrderIds,
    mode: "cancelled",
    operationId: params.operationKey,
    now,
  });
  const legacy = await restoreLegacyConsignmentsInSession({
    session,
    orderId: String(order._id),
    subOrderIds,
  });
  const freedQuota = await releaseConsignmentQuotaInSession({
    session,
    orderId: String(order._id),
    subOrderIds,
  });
  const operation = await insertOperationInSession(session, {
    key: params.operationKey,
    kind: params.kind,
    orderId: order._id,
    orderNumber: order.orderNumber,
    subOrderIds: scope.map((sub) => sub._id),
    cycleId: order.preorderCollection?.cycleId,
    wholeOrder,
    reasonCode: params.reasonCode,
    reason: params.reason,
    actor: params.actor,
    actorRole: params.actorRole,
    actorEmail: params.actorEmail,
    source: params.source,
    effects: cancellationEffects({ wholeOrder, notifyCustomer: params.notifyCustomer }),
    now,
  });
  return {
    operationId: operation.operationId,
    orderNumber: order.orderNumber,
    wholeOrder,
    from: String(order.status || ""),
    to: derived,
    preorderFrom: order.preorderStatus,
    preorderTo,
    consignmentFrom: scope.length === 1 ? scope[0].status : undefined,
    subOrderIds,
    aftermath: {
      movedLines: [
        ...restored.restored.flatMap((entry) => entry.lines),
        ...legacy.flatMap((entry) => entry.lines),
      ],
      freedQuota,
    },
  };
}

export type PreorderCancellationOutcome =
  | {
      kind: "cancelled";
      operationId: string;
      wholeOrder: boolean;
      status: string;
      subOrderIds: string[];
      refund?: {
        refunded: boolean;
        amount?: number;
        currency?: string;
        reason?: string;
        gatewayCalled?: boolean;
        pending?: boolean;
      };
    }
  | { kind: "refused"; reason: string }
  | { kind: "in_progress" }
  | { kind: "unavailable"; reason: string };

const CANCEL_FIELDS =
  "_id orderNumber status preorderStatus preorderCollection preorderRelease subOrders._id subOrders.vendorId subOrders.status subOrders.items.purchaseType subOrders.items.preorderStatus";

/**
 * Cancel a pre-order — all of it, or the consignments named — and carry out
 * what follows through the durable operation, inline where it can.
 */
export async function cancelPreorder(params: {
  orderId: string;
  /** Omitted: every live consignment (refused if any has shipped). */
  subOrderIds?: string[];
  actor: string;
  /** For the audit trail of what follows (the refund above all). */
  actorRole?: string;
  actorEmail?: string;
  source: string;
  reason: string;
  /** Extra filter (staff scope, a customer's own order) the order must match. */
  scopeFilter?: Record<string, unknown>;
  /** False when the caller tells the shopper itself (default: tell them). */
  notifyCustomer?: boolean;
  /** The order's Activity Log row for the cancel itself (none when omitted). */
  audit?: {
    context: AuditContext;
    /** The seller, when a seller cancelled only their own consignment. */
    consignmentOf?: string;
    reason?: string;
    bulk?: boolean;
  };
  now?: Date;
}): Promise<PreorderCancellationOutcome> {
  const now = params.now || new Date();
  if (!Types.ObjectId.isValid(params.orderId)) return { kind: "refused", reason: "order_missing" };
  const stamp = new Types.ObjectId().toHexString();
  let result: CancelScopeResult;
  try {
    result = await runTransaction("Cancel pre-order", async (session) => {
      const order = (await Order.findOne({ ...(params.scopeFilter || {}), _id: params.orderId })
        .session(session)
        .select(CANCEL_FIELDS)
        .lean()) as CancellableOrder | null;
      if (!order) throw new CancellationRefused("order_missing");
      if (order.status === ORDER_STATUS.CANCELLED) throw new CancellationRefused("already_cancelled");
      const live = (order.subOrders || []).filter((sub) => sub.status !== ORDER_STATUS.CANCELLED);
      const scopeIds = params.subOrderIds?.length
        ? params.subOrderIds
        : live.map((sub) => String(sub._id));
      return cancelScopeInSession({
        session,
        order,
        scopeIds,
        ended: "cancelled",
        kind: "cancel",
        operationKey: `cancel:${params.orderId}:${stamp}`,
        actor: params.actor,
        actorRole: params.actorRole,
        actorEmail: params.actorEmail,
        source: params.source,
        reasonCode: "cancelled",
        reason: params.reason,
        cancelReason: params.reason,
        notifyCustomer: params.notifyCustomer,
        now,
      });
    });
  } catch (error) {
    if (error instanceof CancellationRefused) return { kind: "refused", reason: error.reason };
    if (error instanceof TransactionsUnavailableError) {
      return { kind: "unavailable", reason: error.message };
    }
    if (
      error instanceof TransactionContendedError ||
      error instanceof TransactionOutcomeUnknownError
    ) {
      return { kind: "in_progress" };
    }
    throw error;
  }
  // Before the stock and the refund, so the Timeline reads "cancelled" first
  // and the refund it caused after it.
  if (params.audit) {
    const { consignmentOf } = params.audit;
    await auditPreorderMove(
      params.audit.context,
      { _id: params.orderId, orderNumber: result.orderNumber },
      {
        move: "cancel",
        consignmentOf,
        from: {
          status: result.from,
          preorderStatus: result.preorderFrom,
          ...(consignmentOf ? { consignmentStatus: result.consignmentFrom } : {}),
        },
        to: {
          status: result.to,
          preorderStatus: result.preorderTo,
          ...(consignmentOf ? { consignmentStatus: ORDER_STATUS.CANCELLED } : {}),
        },
        reason: params.audit.reason,
        bulk: params.audit.bulk,
      },
    );
  }
  await runAllocationAftermath(result.aftermath);
  await runPreorderOperation(result.operationId, { now }).catch((error) =>
    console.error("Failed to finish a pre-order cancellation:", error),
  );
  const operation = await PreorderOperation.findById(result.operationId)
    .select("refund state")
    .lean<{ refund?: { state?: string; amount?: number; currency?: string; reason?: string; gatewayCalled?: boolean }; state?: string } | null>();
  const refund = operation?.refund;
  return {
    kind: "cancelled",
    operationId: result.operationId,
    wholeOrder: result.wholeOrder,
    status: result.to,
    subOrderIds: result.subOrderIds,
    ...(refund
      ? {
          refund: {
            refunded: refund.state === "succeeded" || refund.state === "manual",
            amount: refund.amount,
            currency: refund.currency,
            reason: refund.reason,
            gatewayCalled: refund.state === "manual" ? false : refund.gatewayCalled,
            pending: refund.state === "submitting" || refund.state === "unknown" || refund.state === "pending",
          },
        }
      : {}),
  };
}
