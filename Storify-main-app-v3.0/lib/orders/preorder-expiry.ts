import { Types, type ClientSession } from "mongoose";
import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import {
  getPreorderBalanceDeadline,
  getPreorderBalanceDue,
  owesPreorderBalanceMatch,
  PAY_LATER_PAYMENT_METHOD,
} from "@/lib/orders/order-payment-status";
import { PREORDER_ITEM_STATUS, PURCHASE_TYPE } from "@/lib/orders/preorders";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import {
  getTransactionSupport,
  runTransaction,
  TransactionContendedError,
  TransactionOutcomeUnknownError,
} from "@/lib/db-transaction";
import { runAllocationAftermath } from "@/lib/orders/preorder-allocation";
import { runPreorderOperation } from "@/lib/orders/preorder-operations";
import { cancelScopeInSession } from "@/lib/orders/preorder-cancellation";

/**
 * Giving up on a balance that never arrived — as one durable cancellation.
 *
 * The old sweep wrote `cancelled` on the order, then restored stock, freed the
 * reservation, reversed the coupon, refunded and notified, each as a separate
 * step after the fact. A crash anywhere after the first write lost the rest
 * for good: the order no longer matched "unpaid", so nothing ever looked at it
 * again. Its consignments were never cancelled either — only the parent — so
 * a split order read cancelled over sub-orders still marked as waiting, and a
 * dispatched sibling could be swept into the same blanket write.
 *
 * Now one transaction, re-checked against the order as it stands at the
 * moment of writing (paid in the meantime, given a later date, its request
 * replaced — any of those and the expiry loses), cancels exactly the
 * consignments still waiting on the balance, marks their pre-order lines
 * expired, derives the parent's status from what survives, puts back the
 * stock their allocation took (from its evidence), frees the reservation
 * places they held, and records a {@link PreorderOperation} for everything
 * outside the database: labels, the coupon, the write-off, a refund of
 * exactly the cancelled scope, and a truthful message. That operation is
 * resumed by `lib/orders/preorder-operations.ts` until it completes or names
 * the person who has to act.
 *
 * Transactions are required; a deployment without them reports itself
 * unavailable and expires nothing, rather than falling back to the old path.
 */

/** Days past the due date an unpaid balance survives, when the store has not said. */
export const PREORDER_EXPIRY_GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ExpirySummary = {
  /** False when the deployment cannot run the transaction it needs. */
  enabled: boolean;
  unavailableReason?: string;
  graceDays: number;
  candidates: number;
  expired: number;
  /** Lost to a payment, a later date or a new request that landed meanwhile. */
  skipped: number;
  /** Of the operations this run created: finished, still going, or stuck. */
  completed: number;
  pending: number;
  attention: number;
};

type ExpiryOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  total?: number;
  preorderStatus?: string;
  preorderOutstandingAmount?: number;
  preorderReleaseDate?: Date;
  preorderBalanceRequestedAt?: Date | null;
  preorderBalancePaidAt?: Date | null;
  preorderCollection?: {
    cycleId?: string;
    state?: string;
    notice?: { acceptedAt?: Date | null } | null;
  } | null;
  items?: Array<{ vendorId?: unknown; purchaseType?: string; preorderStatus?: string }>;
  subOrders?: Array<{
    _id: Types.ObjectId;
    vendorId?: unknown;
    status?: string;
    items?: Array<{
      purchaseType?: string;
      preorderStatus?: string;
      preorderOutstandingAmount?: number | null;
    }>;
  }>;
};

/**
 * Orders whose balance deadline has passed, as the database can tell it.
 *
 * Exact rather than a loose superset, so a batch is never filled with orders
 * the loop would only skip — which would starve the ones behind them. A
 * request made through a collection cycle counts from its ACCEPTED notice; one
 * whose notice was never accepted has no deadline and is not here (it waits
 * for a person instead). Older requests keep counting from the later of the
 * release and request dates.
 */
export function expiryCandidateFilter(cutoff: Date): Record<string, unknown> {
  return {
    hasPreorder: true,
    preorderStatus: PREORDER_ITEM_STATUS.PAYMENT_DUE,
    status: { $ne: ORDER_STATUS.CANCELLED },
    ...owesPreorderBalanceMatch(),
    preorderOutstandingAmount: { $gt: 0 },
    preorderBalancePaidAt: null,
    preorderReleaseDate: { $lt: cutoff },
    $or: [
      {
        "preorderCollection.cycleId": { $exists: false },
        $expr: {
          $lt: [{ $max: ["$preorderReleaseDate", "$preorderBalanceRequestedAt"] }, cutoff],
        },
      },
      {
        "preorderCollection.state": "awaiting_payment",
        "preorderCollection.notice.acceptedAt": { $lt: cutoff },
      },
    ],
  };
}

const EXPIRY_FIELDS =
  "_id orderNumber preorderRelease status paymentStatus paymentMethod total preorderStatus preorderOutstandingAmount preorderReleaseDate preorderBalanceRequestedAt preorderBalancePaidAt preorderCollection items.vendorId items.purchaseType items.preorderStatus subOrders._id subOrders.vendorId subOrders.status subOrders.items.purchaseType subOrders.items.preorderStatus subOrders.items.preorderOutstandingAmount";

function waitingScope(order: ExpiryOrder) {
  return (order.subOrders || []).filter(
    (sub) =>
      sub.status === ORDER_STATUS.PREORDERED &&
      (sub.items || []).some((item) => item?.purchaseType === PURCHASE_TYPE.PREORDER),
  );
}

type ExpireOne =
  | {
      kind: "expired";
      operationId: string;
      aftermath: Parameters<typeof runAllocationAftermath>[0];
      wholeOrder: boolean;
      from: string;
      to: string;
    }
  | { kind: "skipped"; reason: string };

/**
 * Expire one order, if — re-read inside the transaction — it is still owed,
 * still on the request it was selected under, and past its deadline.
 */
export async function expirePreorderInSession(params: {
  session: ClientSession;
  orderId: Types.ObjectId | string;
  expectedCycleId?: string;
  graceDays: number;
  now: Date;
  /** Test seam: pause after the transaction's read. */
  hooks?: { afterRead?: () => Promise<void> | void };
}): Promise<ExpireOne> {
  const { session, now } = params;
  const order = (await Order.findById(params.orderId)
    .session(session)
    .select(EXPIRY_FIELDS)
    .lean()) as ExpiryOrder | null;
  await params.hooks?.afterRead?.();
  if (!order) return { kind: "skipped", reason: "order_missing" };
  if (order.status === ORDER_STATUS.CANCELLED) return { kind: "skipped", reason: "cancelled" };
  if (order.preorderStatus !== PREORDER_ITEM_STATUS.PAYMENT_DUE) {
    return { kind: "skipped", reason: "not_payment_due" };
  }
  if (order.preorderBalancePaidAt || getPreorderBalanceDue(order) <= 0) {
    return { kind: "skipped", reason: "paid" };
  }
  const owes =
    order.paymentStatus === "partially_paid" ||
    (order.paymentStatus === "pending" && order.paymentMethod === PAY_LATER_PAYMENT_METHOD);
  if (!owes) return { kind: "skipped", reason: "not_owing" };
  const cycleId = order.preorderCollection?.cycleId;
  if ((params.expectedCycleId || undefined) !== (cycleId || undefined)) {
    return { kind: "skipped", reason: "request_replaced" };
  }
  // The deadline as it stands NOW — a delay or a fresh notice may have
  // landed after the candidate was read.
  const deadline = getPreorderBalanceDeadline(order, params.graceDays);
  if (!deadline || deadline.getTime() >= now.getTime()) {
    return { kind: "skipped", reason: "not_due" };
  }
  const scope = waitingScope(order);
  if (scope.length === 0) return { kind: "skipped", reason: "nothing_waiting" };

  const key = `expire:${String(order._id)}:${cycleId || "legacy"}`;
  const result = await cancelScopeInSession({
    session,
    order: order as Parameters<typeof cancelScopeInSession>[0]["order"],
    scopeIds: scope.map((sub) => String(sub._id)),
    ended: "expired",
    kind: "expire",
    operationKey: key,
    actor: "system",
    source: "expiry",
    reasonCode: "balance_unpaid",
    reason: "Pre-order expired — balance not paid",
    cancelReason: "Pre-order balance was not paid",
    now,
  });
  return {
    kind: "expired",
    operationId: result.operationId,
    wholeOrder: result.wholeOrder,
    from: result.from,
    to: result.to,
    aftermath: result.aftermath,
  };
}

/**
 * The daily expiry pass: find, expire (each in its own transaction), then run
 * the operations it created. Repeat runs are harmless — an expired order no
 * longer matches, and its operation is keyed to it.
 */
export async function expireUnpaidPreorders(
  options: { limit?: number; now?: Date } = {},
): Promise<ExpirySummary> {
  const now = options.now || new Date();
  const settings = await getSettings();
  const graceDays =
    resolvePreorderPolicy(settings.preorder).expiryGraceDays || PREORDER_EXPIRY_GRACE_DAYS;
  const summary: ExpirySummary = {
    enabled: true,
    graceDays,
    candidates: 0,
    expired: 0,
    skipped: 0,
    completed: 0,
    pending: 0,
    attention: 0,
  };
  const support = await getTransactionSupport();
  if (!support.supported) {
    return { ...summary, enabled: false, unavailableReason: support.reason };
  }

  const cutoff = new Date(now.getTime() - graceDays * DAY_MS);
  const candidates = await Order.find(expiryCandidateFilter(cutoff))
    .sort({ preorderReleaseDate: 1, _id: 1 })
    .select("_id orderNumber preorderCollection.cycleId")
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 500))
    .lean<Array<{ _id: Types.ObjectId; orderNumber: string; preorderCollection?: { cycleId?: string } }>>();
  summary.candidates = candidates.length;

  const operations: string[] = [];
  for (const candidate of candidates) {
    let result: ExpireOne;
    try {
      result = await runTransaction("Expire pre-order", (session) =>
        expirePreorderInSession({
          session,
          orderId: candidate._id,
          expectedCycleId: candidate.preorderCollection?.cycleId,
          graceDays,
          now,
        }),
      );
    } catch (error) {
      if (
        error instanceof TransactionContendedError ||
        error instanceof TransactionOutcomeUnknownError
      ) {
        // Somebody else is changing it right now — next run.
        summary.skipped += 1;
        continue;
      }
      console.error(`Failed to expire pre-order ${candidate.orderNumber}:`, error);
      summary.skipped += 1;
      continue;
    }
    if (result.kind === "skipped") {
      summary.skipped += 1;
      continue;
    }
    summary.expired += 1;
    operations.push(result.operationId);
    await runAllocationAftermath(result.aftermath);
    const { auditOrderCancelled, auditOrderStatus, systemActor } = await import(
      "@/lib/orders/audit-order"
    );
    if (result.wholeOrder) {
      await auditOrderCancelled(systemActor(), candidate, {
        from: result.from,
        by: "system",
        reason: "Pre-order expired — the balance was not paid in time",
      });
    } else if (result.from !== result.to) {
      await auditOrderStatus(systemActor(), candidate, {
        from: result.from,
        to: result.to,
        reason: "Unpaid pre-order consignments expired",
      });
    }
  }

  for (const operationId of operations) {
    const outcome = await runPreorderOperation(operationId, { now });
    if (outcome === "completed") summary.completed += 1;
    else if (outcome === "attention") summary.attention += 1;
    else summary.pending += 1;
  }
  return summary;
}
