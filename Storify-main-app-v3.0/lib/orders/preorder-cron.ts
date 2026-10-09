import { Types } from "mongoose";
import { Order } from "@/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import {
  PAY_LATER_PAYMENT_METHOD,
  getPreorderBalanceDue,
  owesPreorderBalanceMatch,
} from "@/lib/orders/order-payment-status";
import { PREORDER_ITEM_STATUS } from "@/lib/orders/preorders";
import { notifyPreorderCustomerUpdate } from "@/lib/notifications/notifications";
import { getSettings } from "@/models/settings.model";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import {
  collectionScope,
  isActiveCollection,
  isConsignmentReady,
} from "@/lib/orders/preorder-scope";
import {
  preparePreorderCollection,
  type PreparationOutcome,
} from "@/lib/orders/preorder-collection";
import { reconcileOrderPreorderTerms } from "@/lib/orders/preorder-terms-sync";
import { getTransactionSupport } from "@/lib/db-transaction";

export { expireUnpaidPreorders } from "@/lib/orders/preorder-expiry";

/**
 * The clock a pre-order runs on.
 *
 * Every pass here is idempotent per order, not per run: each action is a
 * conditional claim on one document (a reminder stage, a request, a release),
 * so overlapping runs or a retry after a timeout cannot repeat it. Nothing here
 * invents a release date, and nothing here keeps money: an expiry refunds in
 * full, exactly as any other cancellation.
 *
 * The work is split by how fast it has to happen. The frequent job
 * (`/api/cron/preorder-jobs`) resumes lifecycle operations, carries moved
 * dates to waiting orders, sends and confirms balance notices, charges saved
 * cards whose notice window has passed and recovers paid releases. The daily
 * job (`/api/cron/preorders`) prepares balance requests (the automatic
 * release, legacy requests, consignments that became ready), reminds, expires
 * and reports. Each pass re-checks its own guards; the order of passes only
 * reduces races, it is not what prevents them.
 */

/**
 * Reminder stages, keyed by how long before the release date they go out.
 * MUST stay ordered furthest-first.
 */
const PREORDER_REMINDER_STAGES = [
  { key: "t-7", daysBefore: 7 },
  { key: "t-1", daysBefore: 1 },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Orders that owe a balance on an open request and are alive to pay it. */
function unpaidBalanceFilter() {
  return {
    hasPreorder: true,
    preorderStatus: PREORDER_ITEM_STATUS.PAYMENT_DUE,
    status: { $ne: ORDER_STATUS.CANCELLED },
    ...owesPreorderBalanceMatch(),
    preorderOutstandingAmount: { $gt: 0 },
  };
}

/** A reservation still waiting on its goods — on its first date or a moved one. */
const WAITING_PREORDER_STATUSES: string[] = [
  PREORDER_ITEM_STATUS.RESERVED,
  PREORDER_ITEM_STATUS.DELAYED,
  PREORDER_ITEM_STATUS.PARTIALLY_READY,
];

type CronOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId?: unknown;
  guestEmail?: string;
  total?: number;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  preorderReleaseDate?: Date;
  preorderBalanceRequestedAt?: Date | null;
  preorderOutstandingAmount?: number;
  preorderBalancePaidAt?: Date | null;
  preorderCollection?: {
    cycleId?: string;
    state?: string;
    notice?: { acceptedAt?: Date | null } | null;
  } | null;
  subOrders?: Array<{
    _id?: Types.ObjectId;
    status?: string;
    preorderReadiness?: { declaredAt?: Date | null } | null;
    items?: Array<{ purchaseType?: string; quantity?: number; preorderOutstandingAmount?: number | null }> | null;
  }> | null;
};

const CRON_ORDER_FIELDS =
  "_id orderNumber customerId guestEmail total status paymentStatus paymentMethod preorderReleaseDate preorderBalanceRequestedAt preorderOutstandingAmount preorderBalancePaidAt preorderCollection subOrders._id subOrders.status subOrders.preorderReadiness subOrders.items.purchaseType subOrders.items.quantity subOrders.items.preorderOutstandingAmount";

/**
 * Nudge shoppers whose balance falls due soon.
 *
 * Only on requests the shopper has actually been told about: a request made
 * through a collection cycle is reminded once its advance notice was
 * accepted, never before (and never as a substitute for it). A reminder never
 * moves the deadline — the deadline counts from the notice.
 */
export async function sendPreorderBalanceReminders(limit = 200): Promise<{
  sent: number;
  byStage: Record<string, number>;
}> {
  const now = Date.now();
  const byStage: Record<string, number> = {};
  let sent = 0;

  for (const [index, stage] of PREORDER_REMINDER_STAGES.entries()) {
    byStage[stage.key] = 0;
    const nearerStage = PREORDER_REMINDER_STAGES[index + 1];
    const stageFilter = {
      ...unpaidBalanceFilter(),
      preorderReleaseDate: {
        $lte: new Date(now + stage.daysBefore * DAY_MS),
        ...(nearerStage
          ? { $gt: new Date(now + nearerStage.daysBefore * DAY_MS) }
          : {}),
      },
      preorderBalanceRemindersSent: { $ne: stage.key },
      $or: [
        { "preorderCollection.cycleId": { $exists: false } },
        { "preorderCollection.state": "awaiting_payment" },
      ],
    };
    const due = await Order.find(stageFilter)
      .select(CRON_ORDER_FIELDS)
      .limit(limit)
      .lean<CronOrder[]>();

    for (const order of due) {
      if (getPreorderBalanceDue(order) <= 0) continue;
      if (!order.customerId && !order.guestEmail) continue;
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, preorderBalanceRemindersSent: { $ne: stage.key } },
        { $addToSet: { preorderBalanceRemindersSent: stage.key } },
      ).lean();
      if (!claimed) continue;

      await notifyPreorderCustomerUpdate(
        String(order.customerId || ""),
        order.orderNumber,
        "payment_due",
        String(order._id),
        {
          releaseDate: order.preorderReleaseDate,
          outstandingAmount: getPreorderBalanceDue(order),
          balanceRequestedAt: order.preorderBalanceRequestedAt ?? undefined,
          preorderCollection: order.preorderCollection,
          reminderStage: stage.key,
          balanceCycleId: order.preorderCollection?.cycleId,
          guestEmail: order.guestEmail,
        },
      ).catch((err) =>
        console.error(
          `Failed to send ${stage.key} pre-order balance reminder for ${order.orderNumber}:`,
          err,
        ),
      );
      byStage[stage.key] += 1;
      sent += 1;
    }
  }
  return { sent, byStage };
}

type PreparationTally = {
  noticePending: number;
  released: number;
  waitingOnVendors: number;
  waitingOnStock: number;
  datePending: number;
  attention: number;
};

function tally(outcome: PreparationOutcome, totals: PreparationTally) {
  switch (outcome.kind) {
    case "notice_pending":
      totals.noticePending += 1;
      break;
    case "released":
      totals.released += 1;
      break;
    case "waiting_for_vendors":
      totals.waitingOnVendors += 1;
      break;
    case "waiting_for_stock":
      totals.waitingOnStock += 1;
      break;
    case "not_eligible":
      if (outcome.reason === "date_sync_pending") totals.datePending += 1;
      break;
    case "reconciliation_required":
    case "conflict":
      totals.attention += 1;
      break;
    default:
      break;
  }
}

/**
 * Prepare what is due — the daily half of the collection workflow.
 *
 *  1. **Automatic release** (only when the store switched it on): a waiting
 *     order whose release date (plus the store's delay) has passed has every
 *     waiting consignment declared available by the system and is prepared
 *     exactly as a person's click would — stock allocated, the request and
 *     its notice written, or with nothing owed the goods released. Its dates
 *     are brought up to the products' current terms first; a date that moved
 *     later is no longer due.
 *  2. **Consignments that became ready** with no request standing — a stock
 *     shortage that has since been restocked, a sibling cancelled — are
 *     prepared again. Every seller already said their goods were in.
 *  3. **Requests from before collection cycles** — `payment_due` with no
 *     cycle — are adopted: allocated and given a request with an advance
 *     notice, so nothing is ever charged on an old request without one.
 *
 * Bounded and fair: an order passed over is stamped, and the least recently
 * checked come first.
 */
export async function preparePreorderCollections(
  options: { limit?: number; now?: Date } = {},
): Promise<
  PreparationTally & {
    enabled: boolean;
    autoRelease: boolean;
    unavailableReason?: string;
    candidates: number;
  }
> {
  const now = options.now || new Date();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const settings = await getSettings();
  const policy = resolvePreorderPolicy(settings.preorder);
  const totals: PreparationTally = {
    noticePending: 0,
    released: 0,
    waitingOnVendors: 0,
    waitingOnStock: 0,
    datePending: 0,
    attention: 0,
  };
  const support = await getTransactionSupport();
  if (!support.supported) {
    return {
      ...totals,
      enabled: false,
      autoRelease: policy.autoRelease,
      unavailableReason: support.reason,
      candidates: 0,
    };
  }

  const passOver = (orderId: unknown) =>
    Order.updateOne(
      { _id: orderId },
      { $set: { preorderAutoReleaseCheckedAt: now } },
    ).catch((err) =>
      console.error("Failed to stamp a pre-order the preparation passed over:", err),
    );

  // A gateway order the shopper walked away from never captured anything.
  const paidOrPayLater = {
    $or: [
      { paymentStatus: { $ne: PAYMENT_STATUS.PENDING } },
      { paymentMethod: PAY_LATER_PAYMENT_METHOD },
    ],
  };
  const cutoff = new Date(now.getTime() - policy.autoReleaseDelayDays * DAY_MS);
  const queries: Array<{ source: "auto" | "admin" | "legacy"; filter: Record<string, unknown> }> = [];
  if (policy.autoRelease) {
    queries.push({
      source: "auto",
      filter: {
        hasPreorder: true,
        preorderStatus: { $in: WAITING_PREORDER_STATUSES },
        status: { $ne: ORDER_STATUS.CANCELLED },
        preorderReleaseDate: { $lte: cutoff },
        ...paidOrPayLater,
      },
    });
  }
  queries.push({
    source: "admin",
    filter: {
      hasPreorder: true,
      preorderStatus: { $in: WAITING_PREORDER_STATUSES },
      status: { $ne: ORDER_STATUS.CANCELLED },
      "subOrders.preorderReadiness.declaredAt": { $exists: true },
      ...paidOrPayLater,
    },
  });
  queries.push({
    source: "legacy",
    filter: {
      ...unpaidBalanceFilter(),
      "preorderCollection.cycleId": { $exists: false },
    },
  });

  let candidates = 0;
  const seen = new Set<string>();
  for (const query of queries) {
    const orders = await Order.find(query.filter)
      .sort({ preorderAutoReleaseCheckedAt: 1, preorderReleaseDate: 1, _id: 1 })
      .select(CRON_ORDER_FIELDS)
      .limit(limit)
      .lean<CronOrder[]>();
    for (const order of orders) {
      const key = String(order._id);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates += 1;
      if (isActiveCollection(order.preorderCollection)) continue;
      const scope = collectionScope(order);
      if (scope.length === 0) {
        await passOver(order._id);
        continue;
      }
      if (
        query.source === "admin" &&
        !scope.every(isConsignmentReady) &&
        getPreorderBalanceDue(order) > 0
      ) {
        // Somebody's goods are still out: no balance can be asked for yet.
        // (With nothing owed, the ready consignments are released on their
        // own — the preparation below does exactly that.)
        totals.waitingOnVendors += 1;
        await passOver(order._id);
        continue;
      }
      if (query.source === "auto") {
        // Dates first: a release date that moved past the cutoff is not due
        // today. (One that moved but is still due goes ahead; the coordinator
        // re-checks the terms inside its own transaction either way.)
        const reconciled = await reconcileOrderPreorderTerms(key, { now }).catch(() => null);
        if (reconciled?.status === "moved" && reconciled.orderDateMoved) {
          const moved = await Order.findById(order._id)
            .select("preorderReleaseDate")
            .lean<{ preorderReleaseDate?: Date | null }>();
          const releaseAt = moved?.preorderReleaseDate
            ? new Date(moved.preorderReleaseDate).getTime()
            : Number.POSITIVE_INFINITY;
          if (!(releaseAt <= cutoff.getTime())) {
            totals.datePending += 1;
            await passOver(order._id);
            continue;
          }
        }
      }
      const outcome = await preparePreorderCollection({
        orderId: key,
        actor: "system",
        source: query.source,
        declare:
          query.source === "admin" ? undefined : scope.map((sub) => String(sub._id)),
        requireCurrentTerms: query.source === "auto",
        now,
      }).catch(
        (error: unknown): PreparationOutcome => ({
          kind: "not_eligible",
          reason: error instanceof Error ? error.message : "failed",
        }),
      );
      tally(outcome, totals);
      if (outcome.kind !== "notice_pending" && outcome.kind !== "released") {
        await passOver(order._id);
      }
    }
  }
  return { ...totals, enabled: true, autoRelease: policy.autoRelease, candidates };
}

/**
 * Reservations whose release date has come and gone with nothing shipped.
 * Counted, never acted on: a new date is the vendor's to give.
 */
export async function countOverdueReleases(): Promise<number> {
  return Order.countDocuments({
    hasPreorder: true,
    preorderStatus: { $in: WAITING_PREORDER_STATUSES },
    status: { $ne: ORDER_STATUS.CANCELLED },
    preorderReleaseDate: { $lt: new Date() },
  });
}

/**
 * Durable counts for the cron output and the health check — what the
 * workflow holds, not what this run happened to attempt.
 */
export async function preorderWorkflowCounts(): Promise<{
  noticesPending: number;
  noticesNeedingAttention: number;
  awaitingPayment: number;
  chargesDue: number;
  releasesWaiting: number;
  releasesNeedingAttention: number;
}> {
  const now = new Date();
  const [noticesPending, noticesNeedingAttention, awaitingPayment, chargesDue, releasesWaiting, releasesNeedingAttention] =
    await Promise.all([
      Order.countDocuments({ "preorderCollection.state": "notice_pending" }),
      Order.countDocuments({ "preorderCollection.state": "attention" }),
      Order.countDocuments({ "preorderCollection.state": "awaiting_payment" }),
      Order.countDocuments({
        "preorderCollection.state": "awaiting_payment",
        "preorderCollection.chargeNotBefore": { $lte: now },
      }),
      Order.countDocuments({ "preorderRelease.state": { $in: ["requested", "waiting"] } }),
      Order.countDocuments({ "preorderRelease.state": "attention" }),
    ]);
  return {
    noticesPending,
    noticesNeedingAttention,
    awaitingPayment,
    chargesDue,
    releasesWaiting,
    releasesNeedingAttention,
  };
}
