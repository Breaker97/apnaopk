import { Types, type ClientSession } from "mongoose";
import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import type { IPreorderOperation } from "@/models/preorder-operation.model";
import { PREORDER_ITEM_STATUS, PURCHASE_TYPE } from "@/lib/orders/preorders";
import { deriveOrderStatusFromSubOrders } from "@/lib/orders/order-status-apply";
import { ORDER_STATUS_RANK } from "@/lib/orders/order-status-workflow";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import { getFulfillmentPaymentBlock } from "@/lib/orders/fulfillment-payment-gate";
import {
  AllocationAbort,
  allocateConsignmentsInSession,
  loadAllocationPreferences,
  runAllocationAftermath,
  type AllocationSource,
  type InSessionAllocation,
  type StockBlocker,
} from "@/lib/orders/preorder-allocation";
import {
  collectionScope,
  isConsignmentReady,
  type ScopeSubOrder,
} from "@/lib/orders/preorder-scope";
import { findStaleTermsLines } from "@/lib/orders/preorder-terms";
import {
  getTransactionSupport,
  runTransaction,
  TransactionContendedError,
  TransactionOutcomeUnknownError,
  TransactionsUnavailableError,
} from "@/lib/db-transaction";
import {
  insertOperationInSession,
  releaseEffects,
  runPreorderOperation,
  type EffectResult,
  type OperationEffectName,
} from "@/lib/orders/preorder-operations";
import { PreorderOperation } from "@/models/preorder-operation.model";

/**
 * Releasing pre-order consignments for fulfilment — the one implementation.
 *
 * Every path that ends a pre-order's wait goes through here: a seller or admin
 * marking goods available on an order with nothing left to pay, a balance
 * arriving for a prepared request (card, PayPal, a receipt recorded by hand),
 * the automatic release, and the recovery of paid orders whose release could
 * not finish. Each allocates its consignments through the transactional
 * allocation (`preorder-allocation.ts`) and moves exactly those consignments —
 * never a sibling that has shipped, been cancelled or is still waiting — in
 * the same transaction, then records the label and the "ready" message as a
 * durable operation so they happen once even if the process dies right after.
 *
 * A release that cannot finish is not a failure to report and forget. A paid
 * order whose stock is not in yet is WAITING — `preorderRelease` says so on
 * the order, with the reason and the next attempt — and the recovery pass in
 * the pre-order worker keeps trying, fairly, until the stock arrives or
 * someone cancels.
 */

export type ReleaseSource = AllocationSource;

type ReleaseOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  status?: string;
  preorderStatus?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  channel?: string;
  total?: number;
  hasPreorder?: boolean;
  goodsRefundedAt?: Date | null;
  processingAt?: Date | null;
  preorderOutstandingAmount?: number;
  preorderBalancePaidAt?: Date | null;
  preorderCollection?: { cycleId?: string; state?: string } | null;
  preorderRelease?: { state?: string; operationId?: string; cycleId?: string } | null;
  items?: Array<{ vendorId?: unknown; purchaseType?: string; preorderStatus?: string }>;
  subOrders?: Array<
    ScopeSubOrder & {
      _id: Types.ObjectId;
      vendorId?: unknown;
      paymentStatus?: string;
      items?: Array<{
        productId?: unknown;
        variantId?: unknown;
        purchaseType?: string;
        preorderStatus?: string;
        preorderOutstandingAmount?: number | null;
        preorderTermsRevision?: number | null;
        quantity?: number;
      }>;
    }
  >;
};

const RELEASE_FIELDS =
  "_id orderNumber status preorderStatus paymentStatus paymentMethod channel total hasPreorder goodsRefundedAt processingAt preorderOutstandingAmount preorderBalancePaidAt preorderCollection preorderRelease items.vendorId items.purchaseType items.preorderStatus subOrders";

const id = (value: unknown) =>
  String((value as { _id?: unknown } | null)?._id ?? value ?? "");

export class ReleaseRefused extends Error {
  readonly reason: string;
  readonly kind: "superseded" | "not_eligible" | "date_sync_pending";

  constructor(kind: ReleaseRefused["kind"], reason: string) {
    super(`Release refused: ${reason}`);
    this.name = "ReleaseRefused";
    this.kind = kind;
    this.reason = reason;
  }
}

/** Why a consignment's money does not allow fulfilment, or null when it does. */
export function releasePaymentBlock(order: ReleaseOrder): string | null {
  if (getPreorderBalanceDue(order) > 0) return "balance_due";
  for (const sub of collectionScope(order)) {
    const block = getFulfillmentPaymentBlock(
      order as Parameters<typeof getFulfillmentPaymentBlock>[0],
      sub as Parameters<typeof getFulfillmentPaymentBlock>[1],
    );
    if (block) return block;
  }
  return null;
}

/**
 * Allocate and move `subOrderIds` from `preordered` to `processing`, inside
 * the caller's transaction. Consignments that have already moved on are left
 * alone; the parent's status is derived from what the consignments now say,
 * never backwards.
 *
 * Throws {@link AllocationAbort} (stock, ambiguity) or {@link ReleaseRefused}.
 */
export async function releaseConsignmentsInSession(params: {
  session: ClientSession;
  orderId: string;
  subOrderIds: string[];
  source: ReleaseSource;
  actor: string;
  now: Date;
  allocationOperationId: string;
  preferences?: Map<string, string[]>;
  /** Settlement and recovery check payment; a caller that just did may skip. */
  requirePaid?: boolean;
  /** Auto-release and recovery refuse to act on a stale date. */
  requireCurrentTerms?: boolean;
  /** The release operation this transition belongs to, for the summary. */
  releaseOperationId?: string;
  cycleId?: string;
}): Promise<{ released: string[]; allocation: InSessionAllocation | null }> {
  const { session, now } = params;
  const order = (await Order.findById(params.orderId)
    .session(session)
    .select(RELEASE_FIELDS)
    .lean()) as ReleaseOrder | null;
  if (!order) throw new ReleaseRefused("superseded", "order_missing");
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw new ReleaseRefused("superseded", "order_cancelled");
  }
  if (params.requirePaid !== false) {
    const block = releasePaymentBlock(order);
    if (block) throw new ReleaseRefused("not_eligible", block);
  }
  const wanted = new Set(params.subOrderIds.map(String));
  const targets = collectionScope(order).filter((sub) => wanted.has(id(sub._id)));
  if (targets.length === 0) return { released: [], allocation: null };
  if (params.requireCurrentTerms) {
    const stale = await findStaleTermsLines(
      { subOrders: targets as ReleaseOrder["subOrders"] },
      session,
    );
    if (stale.length > 0) throw new ReleaseRefused("date_sync_pending", "date_sync_pending");
  }

  const allocation = await allocateConsignmentsInSession({
    session,
    orderId: params.orderId,
    subOrderIds: targets.map((sub) => id(sub._id)),
    operationId: params.allocationOperationId,
    source: params.source,
    now,
    preferences: params.preferences,
  });

  const releasedIds = new Set(targets.map((sub) => id(sub._id)));
  const after = (order.subOrders || []).map((sub) =>
    releasedIds.has(id(sub._id))
      ? {
          ...sub,
          status: ORDER_STATUS.PROCESSING,
          items: (sub.items || []).map((item) =>
            item?.purchaseType === PURCHASE_TYPE.PREORDER
              ? { ...item, preorderStatus: PREORDER_ITEM_STATUS.READY }
              : item,
          ),
        }
      : sub,
  );
  const derived = deriveOrderStatusFromSubOrders(after);
  const currentRank = ORDER_STATUS_RANK[String(order.status || "")];
  const derivedRank = derived ? ORDER_STATUS_RANK[derived] : undefined;
  const nextStatus =
    derived && (currentRank === undefined || (derivedRank ?? 0) >= currentRank)
      ? derived
      : order.status;
  const stillWaiting = collectionScope({ subOrders: after }).length > 0;
  const releasedVendorIds = targets.map((sub) => sub.vendorId);

  const set: Record<string, unknown> = {
    status: nextStatus,
    preorderStatus: stillWaiting
      ? PREORDER_ITEM_STATUS.PARTIALLY_READY
      : PREORDER_ITEM_STATUS.READY,
    statusChangedBy: params.actor,
    "items.$[releasedLine].preorderStatus": PREORDER_ITEM_STATUS.READY,
  };
  if (!order.processingAt) set.processingAt = now;
  const arrayFilters: Record<string, unknown>[] = [
    {
      "releasedLine.purchaseType": PURCHASE_TYPE.PREORDER,
      "releasedLine.vendorId": { $in: releasedVendorIds },
    },
    { "readyLine.purchaseType": PURCHASE_TYPE.PREORDER },
  ];
  targets.forEach((sub, index) => {
    set[`subOrders.$[rel${index}].status`] = ORDER_STATUS.PROCESSING;
    set[`subOrders.$[rel${index}].items.$[readyLine].preorderStatus`] =
      PREORDER_ITEM_STATUS.READY;
    arrayFilters.push({
      [`rel${index}._id`]: sub._id,
      [`rel${index}.status`]: ORDER_STATUS.PREORDERED,
    });
  });
  if (params.releaseOperationId) {
    set["preorderRelease.state"] = "released";
    set["preorderRelease.operationId"] = params.releaseOperationId;
    if (params.cycleId) set["preorderRelease.cycleId"] = params.cycleId;
    if (!order.preorderRelease?.state) set["preorderRelease.requestedAt"] = now;
    set["preorderRelease.releasedAt"] = now;
    set["preorderRelease.lastAttemptAt"] = now;
  }
  const written = await Order.updateOne(
    { _id: order._id, status: { $ne: ORDER_STATUS.CANCELLED } },
    { $set: set },
    { session, arrayFilters },
  );
  if (written.matchedCount !== 1) throw new TransactionContendedError("Release pre-order");
  return { released: [...releasedIds], allocation };
}

export type ReleaseOutcome =
  | { kind: "released"; subOrderIds: string[]; operationId: string }
  | { kind: "waiting_for_stock"; blockers: StockBlocker[] }
  | { kind: "in_progress"; retryAfterSeconds: number }
  | { kind: "not_eligible" | "reconciliation_required" | "unavailable" | "conflict"; reason: string };

/**
 * Release consignments of a paid order now — a seller's or an admin's "goods
 * available" on an order with nothing left to pay, or the automatic release.
 * The label and the shopper's message follow from a durable operation.
 */
export async function releasePreorderConsignments(params: {
  orderId: string;
  subOrderIds: string[];
  source: ReleaseSource;
  actor: string;
  now?: Date;
  requireCurrentTerms?: boolean;
}): Promise<ReleaseOutcome> {
  const now = params.now || new Date();
  const order = Types.ObjectId.isValid(params.orderId)
    ? ((await Order.findById(params.orderId)
        .select("_id status subOrders._id subOrders.vendorId subOrders.fulfillment")
        .lean()) as Parameters<typeof loadAllocationPreferences>[0] | null)
    : null;
  if (!order) return { kind: "not_eligible", reason: "order_missing" };
  const preferences = await loadAllocationPreferences(order);
  const stamp = new Types.ObjectId().toHexString();
  const key = `release:${params.orderId}:manual:${stamp}`;
  try {
    const result = await runTransaction("Release pre-order", async (session) => {
      const released = await releaseConsignmentsInSession({
        session,
        orderId: params.orderId,
        subOrderIds: params.subOrderIds,
        source: params.source,
        actor: params.actor,
        now,
        allocationOperationId: `alloc_${stamp}`,
        preferences,
        requireCurrentTerms: params.requireCurrentTerms,
        releaseOperationId: key,
      });
      if (released.released.length === 0) {
        throw new ReleaseRefused("not_eligible", "nothing_waiting");
      }
      const operation = await insertOperationInSession(session, {
        key,
        kind: "release",
        orderId: order._id,
        subOrderIds: released.released.map((value) => new Types.ObjectId(value)),
        actor: params.actor,
        source: params.source,
        reasonCode: "released",
        effects: releaseEffects().map((effect) =>
          effect.name === "transition"
            ? { ...effect, state: "done" as const, attempts: 1, completedAt: now }
            : effect,
        ),
        now,
      });
      // `preorderRelease.operationId` already names this release by its key
      // (written with the transition), as every path does.
      return { ...released, operationId: operation.operationId };
    });
    if (result.allocation) await runAllocationAftermath(result.allocation);
    await runPreorderOperation(result.operationId, { now });
    return {
      kind: "released",
      subOrderIds: result.released,
      operationId: result.operationId,
    };
  } catch (error) {
    return releaseOutcomeFromError(error);
  }
}

export function releaseOutcomeFromError(error: unknown): ReleaseOutcome {
  if (error instanceof AllocationAbort) {
    const outcome = error.outcome;
    if (outcome.kind === "insufficient_stock") {
      return { kind: "waiting_for_stock", blockers: outcome.blockers };
    }
    if (outcome.kind === "in_progress") return outcome;
    if (outcome.kind === "unavailable") return { kind: "unavailable", reason: outcome.reason };
    return { kind: outcome.kind, reason: outcome.reason };
  }
  if (error instanceof ReleaseRefused) {
    return { kind: "not_eligible", reason: error.reason };
  }
  if (error instanceof TransactionsUnavailableError) {
    return { kind: "unavailable", reason: error.message };
  }
  if (
    error instanceof TransactionContendedError ||
    error instanceof TransactionOutcomeUnknownError
  ) {
    return { kind: "in_progress", retryAfterSeconds: 5 };
  }
  throw error;
}

/**
 * Record that a paid order's prepared consignments are to be released, and
 * create the operation that does it. Called the moment a balance settles a
 * prepared request (or a legacy request made before cycles existed).
 *
 * The order-level marker is written first and is the durable intent: if the
 * process dies before the operation exists, the recovery pass finds the
 * marker and creates it (`ensureReleaseOperations`). The operation's key is
 * per order and request, so it is created once whoever gets there first.
 */
export async function requestPreorderRelease(params: {
  orderId: string;
  cycleId?: string;
  source: ReleaseSource;
  actor?: string;
  now?: Date;
  /** Run the operation straight away (best effort; the worker resumes it). */
  runNow?: boolean;
}): Promise<{ operationId: string | null }> {
  const now = params.now || new Date();
  if (!Types.ObjectId.isValid(params.orderId)) return { operationId: null };
  const key = `release:${params.orderId}:${params.cycleId || "legacy"}`;
  const marked = await Order.findOneAndUpdate(
    {
      _id: params.orderId,
      status: { $ne: ORDER_STATUS.CANCELLED },
      $or: [
        { "preorderRelease.state": { $exists: false } },
        { "preorderRelease.state": { $in: ["superseded"] } },
        { "preorderRelease.operationId": key, "preorderRelease.state": { $ne: "released" } },
      ],
    },
    {
      $set: {
        preorderRelease: {
          state: "requested",
          operationId: key,
          ...(params.cycleId ? { cycleId: params.cycleId } : {}),
          requestedAt: now,
          attempts: 0,
          nextAttemptAt: now,
        },
      },
    },
    { returnDocument: "after" },
  )
    .select("_id orderNumber subOrders._id subOrders.status subOrders.items.purchaseType")
    .lean<{
      _id: Types.ObjectId;
      orderNumber: string;
      subOrders?: ScopeSubOrder[];
    } | null>();
  if (!marked) return { operationId: null };
  const operationId = await ensureReleaseOperation({
    key,
    order: marked,
    cycleId: params.cycleId,
    source: params.source,
    actor: params.actor || "system",
    now,
  });
  if (operationId && params.runNow !== false) {
    await runPreorderOperation(operationId, { now }).catch((error) =>
      console.error("Failed to run a pre-order release:", error),
    );
  }
  return { operationId };
}

async function ensureReleaseOperation(params: {
  key: string;
  order: { _id: Types.ObjectId; orderNumber: string; subOrders?: ScopeSubOrder[] };
  cycleId?: string;
  source: ReleaseSource;
  actor: string;
  now: Date;
}): Promise<string | null> {
  const confirm = (operationId: string) =>
    Order.updateOne(
      { _id: params.order._id, "preorderRelease.operationId": params.key },
      { $set: { "preorderRelease.operationCreatedAt": params.now } },
    ).then(() => operationId);
  const existing = await PreorderOperation.findOne({ key: params.key })
    .select("_id")
    .lean<{ _id: Types.ObjectId } | null>();
  if (existing) return confirm(String(existing._id));
  const scope = collectionScope(params.order).map(
    (sub) => new Types.ObjectId(id(sub._id)),
  );
  try {
    const created = await new PreorderOperation({
      key: params.key,
      kind: "release",
      orderId: params.order._id,
      orderNumber: params.order.orderNumber,
      subOrderIds: scope,
      cycleId: params.cycleId,
      state: "pending",
      reasonCode: "release_requested",
      actor: params.actor,
      source: params.source,
      effects: releaseEffects(),
      attempts: 0,
      nextAttemptAt: params.now,
    }).save();
    return confirm(String(created._id));
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) {
      const raced = await PreorderOperation.findOne({ key: params.key })
        .select("_id")
        .lean<{ _id: Types.ObjectId } | null>();
      return raced ? confirm(String(raced._id)) : null;
    }
    throw error;
  }
}

/**
 * The orders whose release was requested and whose operation was never
 * confirmed (the process died between the two writes). Bounded, oldest
 * first — and only those: a request whose operation exists, however long it
 * has been waiting on stock, is not looked at again here.
 */
export async function ensureReleaseOperations(
  options: { limit?: number; now?: Date } = {},
): Promise<number> {
  const now = options.now || new Date();
  const orders = await Order.find({
    "preorderRelease.state": { $in: ["requested", "waiting"] },
    "preorderRelease.operationCreatedAt": { $exists: false },
  })
    .sort({ "preorderRelease.requestedAt": 1, _id: 1 })
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 500))
    .select("_id orderNumber preorderRelease subOrders._id subOrders.status subOrders.items.purchaseType")
    .lean<
      Array<{
        _id: Types.ObjectId;
        orderNumber: string;
        preorderRelease?: { operationId?: string; cycleId?: string };
        subOrders?: ScopeSubOrder[];
      }>
    >();
  let created = 0;
  for (const order of orders) {
    const key = order.preorderRelease?.operationId;
    if (!key || !key.startsWith("release:")) continue;
    const exists = await PreorderOperation.exists({ key });
    if (exists) {
      // Created, but the confirmation was lost with the process.
      await Order.updateOne(
        { _id: order._id, "preorderRelease.operationId": key },
        { $set: { "preorderRelease.operationCreatedAt": now } },
      );
      continue;
    }
    const operationId = await ensureReleaseOperation({
      key,
      order,
      cycleId: order.preorderRelease?.cycleId,
      source: "recovery",
      actor: "system",
      now,
    });
    if (operationId) created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// The release operation's effects
// ---------------------------------------------------------------------------

export async function runReleaseEffect(
  name: OperationEffectName,
  operation: IPreorderOperation,
  context: { now: Date; owner: string },
): Promise<EffectResult> {
  switch (name) {
    case "transition":
      return runReleaseTransition(operation, context);
    case "queue_auto_ship": {
      const { queueAutoShipForOrder } = await import(
        "@/lib/shipping/carriers/shipment-worker"
      );
      await queueAutoShipForOrder(String(operation.orderId));
      return { state: "done" };
    }
    case "notify_ready":
      return runReadyNotice(operation);
    default:
      return { state: "skipped" };
  }
}

async function runReleaseTransition(
  operation: IPreorderOperation,
  context: { now: Date; owner: string },
): Promise<EffectResult> {
  const support = await getTransactionSupport();
  if (!support.supported) {
    return {
      state: "attention",
      reason: "transactions_unavailable",
      detail: support.reason,
    };
  }
  const order = (await Order.findById(operation.orderId)
    .select("_id status subOrders._id subOrders.vendorId subOrders.fulfillment preorderRelease preorderCollection")
    .lean()) as (Parameters<typeof loadAllocationPreferences>[0] & {
      preorderRelease?: { operationId?: string; state?: string };
      preorderCollection?: { cycleId?: string; state?: string } | null;
    }) | null;
  if (!order) return { state: "superseded", reason: "order_missing" };
  if (order.status === ORDER_STATUS.CANCELLED) {
    return { state: "superseded", reason: "order_cancelled" };
  }
  // The request this operation serves must still stand, settled: a delay
  // that reset the readiness voids it, and a newer request replaces it —
  // either way this release is stale, never a release.
  if (
    operation.cycleId &&
    (order.preorderCollection?.cycleId !== operation.cycleId ||
      order.preorderCollection?.state !== "paid")
  ) {
    return { state: "superseded", reason: "readiness_changed" };
  }
  // A date moved later while this paid order waited for its stock: the goods
  // it was released on are not coming yet (`preorder-terms-sync.ts`).
  if (
    order.preorderRelease?.operationId === operation.key &&
    order.preorderRelease?.state === "superseded"
  ) {
    return { state: "superseded", reason: "date_changed" };
  }
  const preferences = await loadAllocationPreferences(order);
  try {
    const result = await runTransaction("Release pre-order", async (session) => {
      const fresh = (await Order.findById(operation.orderId)
        .session(session)
        .select("subOrders preorderRelease")
        .lean()) as { subOrders?: ScopeSubOrder[]; preorderRelease?: { operationId?: string } } | null;
      // Every consignment this request covered must still be declared ready:
      // a withdrawal since means the goods are not in after all.
      const scope = collectionScope(fresh || {}).filter((sub) =>
        operation.subOrderIds.some((value) => String(value) === id(sub._id)),
      );
      if (operation.cycleId && scope.some((sub) => !isConsignmentReady(sub))) {
        throw new ReleaseRefused("superseded", "readiness_changed");
      }
      return releaseConsignmentsInSession({
        session,
        orderId: String(operation.orderId),
        subOrderIds: scope.map((sub) => id(sub._id)),
        source: operation.source === "recovery" ? "recovery" : "settlement",
        actor: "system",
        now: context.now,
        allocationOperationId: `alloc_${String(operation._id)}`,
        preferences,
        requireCurrentTerms: true,
        releaseOperationId: operation.key,
        cycleId: operation.cycleId,
      });
    });
    if (result.allocation) await runAllocationAftermath(result.allocation);
    if (result.released.length === 0) {
      // Already moved on — by an earlier run that died after committing, or
      // by hand. Nothing left to transition; the tail still runs.
      await Order.updateOne(
        { _id: operation.orderId, "preorderRelease.operationId": operation.key },
        { $set: { "preorderRelease.state": "released", "preorderRelease.releasedAt": context.now } },
      );
      return { state: "done", detail: "already released" };
    }
    return { state: "done", detail: `${result.released.length} consignment(s) released` };
  } catch (error) {
    if (error instanceof ReleaseRefused) {
      if (error.kind === "superseded") return { state: "superseded", reason: error.reason };
      if (error.kind === "date_sync_pending") {
        return { state: "waiting", reason: "date_sync_pending", delayMinutes: 30 };
      }
      return { state: "attention", reason: "payment_not_settled", detail: error.reason };
    }
    if (error instanceof AllocationAbort) {
      const outcome = error.outcome;
      if (outcome.kind === "insufficient_stock") {
        return {
          state: "waiting",
          reason: "stock_unavailable",
          detail: outcome.blockers
            .map((blocker) => `${blocker.requested} needed, ${blocker.available} on hand`)
            .join("; "),
        };
      }
      if (outcome.kind === "reconciliation_required") {
        return { state: "attention", reason: "allocation_ambiguous", detail: outcome.reason };
      }
      if (outcome.kind === "not_eligible") {
        return { state: "superseded", reason: outcome.reason };
      }
      return { state: "retry", error: outcome.kind, delayMinutes: 5 };
    }
    if (
      error instanceof TransactionContendedError ||
      error instanceof TransactionOutcomeUnknownError
    ) {
      return { state: "retry", error: "in_progress", delayMinutes: 1 };
    }
    throw error;
  }
}

async function runReadyNotice(operation: IPreorderOperation): Promise<EffectResult> {
  const order = await Order.findById(operation.orderId)
    .select("_id orderNumber customerId guestEmail preorderStatus preorderReleaseDate status")
    .lean<{
      _id: Types.ObjectId;
      orderNumber: string;
      customerId?: unknown;
      guestEmail?: string;
      preorderStatus?: string;
      preorderReleaseDate?: Date;
      status?: string;
    } | null>();
  if (!order) return { state: "skipped", detail: "order missing" };
  if (order.status === ORDER_STATUS.CANCELLED) return { state: "skipped", detail: "cancelled" };
  if (!order.customerId && !order.guestEmail) return { state: "skipped", detail: "no contact" };
  const { notifyPreorderCustomerUpdate } = await import("@/lib/notifications/notifications");
  await notifyPreorderCustomerUpdate(
    String(order.customerId || ""),
    order.orderNumber,
    order.preorderStatus === PREORDER_ITEM_STATUS.PARTIALLY_READY ? "partially_ready" : "ready",
    String(order._id),
    { releaseDate: order.preorderReleaseDate, guestEmail: order.guestEmail },
  );
  return { state: "done" };
}
