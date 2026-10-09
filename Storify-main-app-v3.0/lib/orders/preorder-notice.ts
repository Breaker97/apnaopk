import { Types } from "mongoose";
import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";

/**
 * The advance notice before a saved card is charged for a pre-order balance.
 *
 * Preparing a balance request never charges anything. It writes a cycle in
 * `notice_pending`, and this module sends the notice for it and records what
 * became of the email:
 *
 *  - accepted by the mail server → `notice.acceptedAt`, and the earliest
 *    automatic charge is `acceptedAt + noticeHours` (`chargeNotBefore`), with
 *    the hours frozen on the cycle so a later settings edit cannot shorten a
 *    window already promised. The cycle becomes `awaiting_payment`;
 *  - still on its way (queued, retrying) → stays `notice_pending`; the worker
 *    looks again;
 *  - failed, hard-bounced, or impossible (no address, email switched off,
 *    the shopper opted out of order emails, no mail server) → `attention`.
 *    No automatic charge, no expiry clock, and an admin is told. The shopper
 *    can still pay from their order page or link.
 *
 * Nothing but an accepted email starts the window: not a queued row, not a
 * notifier that returned, not an in-app message.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type NoticeOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  status?: string;
  preorderReleaseDate?: Date | null;
  preorderCollection?: {
    cycleId?: string;
    state?: string;
    amount?: number;
    currency?: string;
    noticeHours?: number;
    autoCharge?: boolean;
    notice?: {
      attempt?: number;
      dedupeKey?: string;
      deliveryId?: Types.ObjectId;
      acceptedAt?: Date;
      failedAt?: Date;
    } | null;
  } | null;
};

export type NoticeOutcome =
  | { state: "accepted"; acceptedAt: Date; chargeNotBefore?: Date }
  | { state: "pending" }
  | { state: "attention"; reason: string }
  | { state: "skipped"; reason: string };

async function loadNoticeOrder(orderId: string): Promise<NoticeOrder | null> {
  if (!Types.ObjectId.isValid(orderId)) return null;
  return Order.findById(orderId)
    .select("_id orderNumber status preorderReleaseDate preorderCollection")
    .lean<NoticeOrder | null>();
}

/**
 * Send (or look again at) the notice for this request. Safe to call any
 * number of times: the email is keyed per request and attempt, and every
 * write is conditional on the request still being current.
 */
export async function issuePreorderBalanceNotice(params: {
  orderId: string;
  cycleId: string;
  now?: Date;
}): Promise<NoticeOutcome> {
  const now = params.now || new Date();
  const order = await loadNoticeOrder(params.orderId);
  const cycle = order?.preorderCollection;
  if (!order || !cycle || cycle.cycleId !== params.cycleId) {
    return { state: "skipped", reason: "request_replaced" };
  }
  if (order.status === ORDER_STATUS.CANCELLED) return { state: "skipped", reason: "cancelled" };
  if (cycle.state !== "notice_pending") return { state: "skipped", reason: String(cycle.state) };

  // Already handed to the outbox: only its answer is wanted.
  if (cycle.notice?.deliveryId) {
    const { readEmailDelivery } = await import("@/lib/email/email");
    const delivery = await readEmailDelivery(String(cycle.notice.deliveryId));
    return applyDelivery(order, delivery ?? { status: "failed", error: "The notice email is gone from the outbox" }, now);
  }

  const settings = await getSettings();
  const policy = resolvePreorderPolicy(settings.preorder);
  const noticeHours = Number(cycle.noticeHours || policy.balanceChargeNoticeHours);
  const release = order.preorderReleaseDate ? new Date(order.preorderReleaseDate) : null;
  // What the shopper is told if the email is accepted now. Acceptance can
  // only come later than `now`, so both dates are at worst a little early —
  // the copy says "on or after" and "by", which stay true.
  const payBy = new Date(
    Math.max(release?.getTime() ?? 0, now.getTime()) + policy.expiryGraceDays * DAY_MS,
  );
  const { deliverPreorderBalanceNotice } = await import("@/lib/notifications/notifications");
  const delivery = await deliverPreorderBalanceNotice({
    orderId: String(order._id),
    cycleId: params.cycleId,
    attempt: Number(cycle.notice?.attempt || 1),
    amount: Number(cycle.amount || 0),
    currency: String(cycle.currency || settings.general?.defaultCurrency || "USD"),
    releaseDate: release,
    chargeNotBefore: cycle.autoCharge ? new Date(now.getTime() + noticeHours * HOUR_MS) : null,
    payBy,
    autoCharge: Boolean(cycle.autoCharge),
    settings,
  });
  return applyDelivery(order, delivery, now);
}

async function applyDelivery(
  order: NoticeOrder,
  delivery: {
    status: string;
    jobId?: string;
    sentAt?: Date;
    hardBounce?: boolean;
    error?: string;
    reason?: string;
  },
  now: Date,
): Promise<NoticeOutcome> {
  const cycle = order.preorderCollection!;
  const filter = {
    _id: order._id,
    "preorderCollection.cycleId": cycle.cycleId,
    "preorderCollection.state": "notice_pending",
  };
  const deliveryId =
    delivery.jobId && Types.ObjectId.isValid(delivery.jobId)
      ? new Types.ObjectId(delivery.jobId)
      : undefined;
  const base: Record<string, unknown> = {
    "preorderCollection.notice.lastCheckedAt": now,
    ...(deliveryId ? { "preorderCollection.notice.deliveryId": deliveryId } : {}),
    ...(deliveryId && !cycle.notice?.deliveryId
      ? { "preorderCollection.notice.queuedAt": now }
      : {}),
  };

  if (delivery.status === "sent" && delivery.sentAt) {
    const acceptedAt = new Date(delivery.sentAt);
    const hours = Number(cycle.noticeHours || 24);
    const chargeNotBefore = cycle.autoCharge
      ? new Date(acceptedAt.getTime() + hours * HOUR_MS)
      : undefined;
    await Order.updateOne(filter, {
      $set: {
        ...base,
        "preorderCollection.state": "awaiting_payment",
        "preorderCollection.notice.acceptedAt": acceptedAt,
        ...(chargeNotBefore ? { "preorderCollection.chargeNotBefore": chargeNotBefore } : {}),
      },
    });
    return { state: "accepted", acceptedAt, ...(chargeNotBefore ? { chargeNotBefore } : {}) };
  }

  if (
    delivery.status === "queued" ||
    delivery.status === "sending" ||
    delivery.status === "retrying"
  ) {
    await Order.updateOne(filter, { $set: base });
    return { state: "pending" };
  }

  // Failed, bounced, cancelled, or never possible.
  const blocked =
    delivery.status === "blocked"
      ? delivery.reason
      : delivery.status === "unconfigured"
        ? "email_unconfigured"
        : undefined;
  const reason = blocked
    ? `notice_${blocked}`
    : delivery.hardBounce
      ? "notice_bounced"
      : "notice_failed";
  const written = await Order.updateOne(filter, {
    $set: {
      ...base,
      "preorderCollection.state": "attention",
      "preorderCollection.attentionReason": reason,
      "preorderCollection.notice.failedAt": now,
      ...(delivery.error
        ? { "preorderCollection.notice.failureReason": delivery.error.slice(0, 500) }
        : {}),
      ...(delivery.hardBounce ? { "preorderCollection.notice.bounced": true } : {}),
      ...(blocked ? { "preorderCollection.notice.blockedReason": blocked } : {}),
    },
  });
  if (written.matchedCount === 1) {
    const { notifyAdminsPaymentAnomaly } = await import("@/lib/notifications/notifications");
    await notifyAdminsPaymentAnomaly({
      title: "A pre-order balance notice did not reach the shopper",
      message: `Order #${order.orderNumber}: the advance notice for its balance could not be delivered (${reason.replace(/_/g, " ")}). No card will be charged automatically for it. Check the shopper's contact details and resend the notice from the pre-order, or collect the balance another way.`,
      dedupeKey: `preorder-notice:${cycle.cycleId}:${Number(cycle.notice?.attempt || 1)}`,
      link: `/admin/orders/${String(order._id)}`,
    }).catch((error) => console.error("Failed to report a balance notice failure:", error));
  }
  return { state: "attention", reason };
}

/**
 * Notices still waiting to be sent or confirmed, oldest request first.
 * Bounded; the next run continues.
 */
export async function processPreorderBalanceNotices(
  options: { limit?: number; now?: Date } = {},
): Promise<{ checked: number; accepted: number; pending: number; attention: number }> {
  const now = options.now || new Date();
  const orders = await Order.find({
    "preorderCollection.state": "notice_pending",
    status: { $ne: ORDER_STATUS.CANCELLED },
  })
    .sort({ "preorderCollection.chargeNotBefore": 1, _id: 1 })
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 500))
    .select("_id preorderCollection.cycleId")
    .lean<Array<{ _id: Types.ObjectId; preorderCollection?: { cycleId?: string } }>>();
  const summary = { checked: 0, accepted: 0, pending: 0, attention: 0 };
  for (const order of orders) {
    const cycleId = order.preorderCollection?.cycleId;
    if (!cycleId) continue;
    const outcome = await issuePreorderBalanceNotice({
      orderId: String(order._id),
      cycleId,
      now,
    }).catch((error): NoticeOutcome => {
      console.error("Failed to process a pre-order balance notice:", error);
      return { state: "pending" };
    });
    summary.checked += 1;
    if (outcome.state === "accepted") summary.accepted += 1;
    else if (outcome.state === "attention") summary.attention += 1;
    else if (outcome.state === "pending") summary.pending += 1;
  }
  return summary;
}

/**
 * Send the notice again — an admin fixed the address, or switched email on.
 * A new attempt under a new key; the window starts from ITS acceptance.
 */
export async function resendPreorderBalanceNotice(params: {
  orderId: string;
  now?: Date;
}): Promise<NoticeOutcome> {
  const now = params.now || new Date();
  const order = await loadNoticeOrder(params.orderId);
  const cycle = order?.preorderCollection;
  if (!order || !cycle?.cycleId) return { state: "skipped", reason: "no_request" };
  if (cycle.state !== "attention" && cycle.state !== "notice_pending") {
    return { state: "skipped", reason: String(cycle.state) };
  }
  const attempt = Number(cycle.notice?.attempt || 1) + 1;
  const reset = await Order.updateOne(
    {
      _id: order._id,
      "preorderCollection.cycleId": cycle.cycleId,
      "preorderCollection.state": cycle.state,
    },
    {
      $set: {
        "preorderCollection.state": "notice_pending",
        "preorderCollection.notice": {
          attempt,
          dedupeKey: `preorder-balance-notice:${cycle.cycleId}:${attempt}`,
        },
      },
      $unset: {
        "preorderCollection.attentionReason": "",
        "preorderCollection.chargeNotBefore": "",
      },
    },
  );
  if (reset.matchedCount !== 1) return { state: "skipped", reason: "changed" };
  return issuePreorderBalanceNotice({ orderId: params.orderId, cycleId: cycle.cycleId, now });
}
