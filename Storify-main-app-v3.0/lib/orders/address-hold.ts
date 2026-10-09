import "server-only";

import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { getSettings, type ISettings } from "@/models/settings.model";
import { createSystemAuditContext, type AuditContext } from "@/lib/audit";
import { auditAddressHold } from "@/lib/orders/audit-order";
import {
  ADDRESS_HOLD_SHIPPING_BLOCK,
  addressHoldDeadline,
  addressHoldDue,
  resolveAddressHoldSettings,
  type AddressHold,
  type AddressHoldReason,
  type AddressHoldRelease,
} from "@/lib/orders/address-hold-policy";
import { CARRIER_ERROR_CODES, CarrierError } from "@/lib/shipping/carriers/errors";
import { placedOrderMatch } from "@/lib/orders/order-payment-status";
import {
  addressKey,
  verifyDeliveryAddress,
} from "@/lib/shipping/address-verification";

/**
 * Pausing shipping on an address a courier can't deliver to, and everything
 * that follows: asking the customer, reminding them, the deadline, and letting
 * go again. The rules without the database are in `address-hold-policy.ts`.
 *
 * Every state change is a compare-and-set on `addressHold.state` (and, for
 * reminders, on how many requests have gone), so a cron run overlapping a
 * merchant's click, or two sweeps, cannot double a reminder or release a hold
 * twice.
 */

const SYSTEM = "system";

/** Orders a hold can sit on: not cancelled, not already with the customer. */
const HOLDABLE_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.PREORDERED,
];

type Actor = { id?: string; context?: AuditContext };

type HoldOrder = {
  _id: unknown;
  orderNumber: string;
  status?: string;
  addressHold?: AddressHold;
};

const REASON_TEXT: Record<AddressHoldReason, string> = {
  carrier_refused: "the courier refused the label",
  validation_failed: "the address check after checkout could not find it",
  store: "the store put it on hold",
};

async function holdSettings(settings?: ISettings) {
  const resolved = settings ?? (await getSettings());
  return resolveAddressHoldSettings(resolved.shipping?.addressHold);
}

function contextOf(actor?: Actor) {
  return actor?.context ?? createSystemAuditContext();
}

function formatDay(value: Date | string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

/**
 * The customer-facing reason inside a carrier's refusal, or a plain default.
 *
 * Exported for tests. The refusal is written for a merchant ("…is not
 * deliverable: X. Correct it on the order.") and the customer's email only
 * needs the X.
 */
function holdReasonFromCarrierMessage(message: string | undefined): string {
  const text = String(message || "");
  const refused = text.match(/is not deliverable: (.+?)\. Correct it on the order/);
  if (refused?.[1]) return refused[1].trim();
  const incomplete = text.match(/cannot be shipped to: (.+)$/);
  if (incomplete?.[1]) return incomplete[1].trim();
  return "The courier couldn't find this address";
}

/**
 * Put an order's shipping on hold. A hold that is already open only has its
 * reason refreshed — the customer is not asked a second time for the same
 * problem. When the store says so, the customer is asked straight away.
 */
export async function placeAddressHold(params: {
  orderId: unknown;
  reason: AddressHoldReason;
  message?: string;
  actor?: Actor;
  settings?: ISettings;
}): Promise<{ placed: boolean }> {
  const message = params.message?.trim().slice(0, 600) || undefined;
  const hold: AddressHold = {
    state: "open",
    reason: params.reason,
    message,
    placedAt: new Date(),
    placedBy: params.actor?.id || SYSTEM,
  };

  const order = await Order.findOneAndUpdate(
    {
      _id: params.orderId,
      status: { $in: HOLDABLE_STATUSES },
      digitalOnly: { $ne: true },
      "fulfillment.method": { $ne: "pickup" },
      "addressHold.state": { $ne: "open" },
    },
    { $set: { addressHold: hold } },
    { returnDocument: "after" },
  ).lean<HoldOrder | null>();

  if (!order) {
    if (message) {
      await Order.updateOne(
        { _id: params.orderId, "addressHold.state": "open" },
        { $set: { "addressHold.message": message } },
      );
    }
    return { placed: false };
  }

  await auditAddressHold(contextOf(params.actor), order, {
    event: "placed",
    summary: `Shipping put on address hold — ${message || REASON_TEXT[params.reason]}`,
    metadata: { reason: params.reason },
  });

  const config = await holdSettings(params.settings);
  if (config.autoRequest) {
    await requestAddressCorrection({
      orderId: params.orderId,
      actor: params.actor,
      settings: params.settings,
    }).catch((error) =>
      console.error("Failed to ask a customer to correct their address:", error),
    );
  }
  return { placed: true };
}

/**
 * Put an order on hold when a carrier refused its delivery address. Anything
 * else — an outage, a bad ship-from, an expired rate — is not the customer's
 * address and holds nothing.
 */
export async function holdOnUndeliverableAddress(
  orderId: unknown,
  error: unknown,
  actor?: Actor,
): Promise<void> {
  if (!(error instanceof CarrierError)) return;
  if (error.code !== CARRIER_ERROR_CODES.ADDRESS_NOT_CARRIER_READY) return;
  // The shipping guard's own refusal of an order already on hold.
  if (error.message === ADDRESS_HOLD_SHIPPING_BLOCK) return;
  await placeAddressHold({
    orderId,
    reason: "carrier_refused",
    message: holdReasonFromCarrierMessage(error.message),
    actor,
  }).catch((holdError) =>
    console.error("Failed to put an order on address hold:", holdError),
  );
}

/**
 * Ask the customer to correct their address, or remind them. The deadline is
 * fixed by the first request and does not move on a resend.
 */
export async function requestAddressCorrection(params: {
  orderId: unknown;
  actor?: Actor;
  settings?: ISettings;
  /** Set by the cron: which reminder this is, and how many had gone before it. */
  reminder?: { number: number; sentBefore: number };
}): Promise<{ sent: boolean; deadlineAt?: Date }> {
  const order = await Order.findOne({
    _id: params.orderId,
    "addressHold.state": "open",
  })
    .select("orderNumber status addressHold")
    .lean<HoldOrder | null>();
  if (!order?.addressHold) return { sent: false };

  const config = await holdSettings(params.settings);
  const now = new Date();
  const requestedAt = order.addressHold.requestedAt
    ? new Date(order.addressHold.requestedAt)
    : now;
  const deadlineAt = order.addressHold.deadlineAt
    ? new Date(order.addressHold.deadlineAt)
    : addressHoldDeadline(requestedAt, config);

  const claimed = await Order.updateOne(
    {
      _id: params.orderId,
      "addressHold.state": "open",
      ...(params.reminder
        ? {
            $or: [
              { "addressHold.requestsSent": params.reminder.sentBefore },
              ...(params.reminder.sentBefore <= 1
                ? [{ "addressHold.requestsSent": { $exists: false } }]
                : []),
            ],
          }
        : {}),
    },
    {
      $set: {
        "addressHold.requestedAt": requestedAt,
        "addressHold.deadlineAt": deadlineAt,
        "addressHold.lastRequestAt": now,
      },
      $inc: { "addressHold.requestsSent": 1 },
    },
  );
  if (!claimed.modifiedCount) return { sent: false };

  const { notifyAddressHoldCustomer } = await import(
    "@/lib/notifications/notifications"
  );
  await notifyAddressHoldCustomer({
    orderId: String(order._id),
    kind: params.reminder ? "reminder" : "request",
    reason: order.addressHold.message,
    deadline: deadlineAt,
    reminderNumber: params.reminder?.number,
    settings: params.settings,
  }).catch((error) =>
    console.error("Failed to send an address request:", error),
  );

  await auditAddressHold(contextOf(params.actor), order, {
    event: params.reminder ? "reminder" : "requested",
    summary: params.reminder
      ? `Address reminder ${params.reminder.number} sent to the customer`
      : `Customer asked to correct the delivery address — deadline ${formatDay(deadlineAt)}`,
  });
  return { sent: true, deadlineAt };
}

/** Let shipping go ahead. The auto-ship queue is nudged so a label follows. */
export async function releaseAddressHold(params: {
  orderId: unknown;
  reason: AddressHoldRelease;
  actor?: Actor;
  /** The timeline sentence, when the default for the reason is not enough. */
  summary?: string;
}): Promise<{ released: boolean }> {
  const order = await Order.findOneAndUpdate(
    { _id: params.orderId, "addressHold.state": "open" },
    {
      $set: {
        "addressHold.state": "released",
        "addressHold.releasedAt": new Date(),
        "addressHold.releasedBy": params.actor?.id || SYSTEM,
        "addressHold.releaseReason": params.reason,
      },
    },
    { returnDocument: "after" },
  ).lean<HoldOrder | null>();
  if (!order) return { released: false };

  const defaults: Record<AddressHoldRelease, string> = {
    address_changed: "Address hold released — the corrected address passed the check",
    store_edited: "Address hold released — staff corrected the address",
    store_confirmed: "Address hold released — staff confirmed the address is correct",
    order_cancelled: "Address hold closed — the order was cancelled",
  };
  await auditAddressHold(contextOf(params.actor), order, {
    event: "released",
    summary: params.summary || defaults[params.reason],
    metadata: { releaseReason: params.reason },
  });

  if (params.reason !== "order_cancelled") {
    const { queueAutoShipForOrder } = await import(
      "@/lib/shipping/carriers/shipment-worker"
    );
    void queueAutoShipForOrder(String(order._id), params.actor?.id).catch((error) =>
      console.error("Failed to queue shipping after an address hold:", error),
    );
  }
  return { released: true };
}

/**
 * The customer says the address is right as it is. The hold stays — a courier
 * already refused it — and the store is told to decide.
 */
export async function confirmAddressByCustomer(params: {
  orderFilter: Record<string, unknown>;
  actor?: Actor;
}): Promise<HoldOrder | null> {
  const order = await Order.findOneAndUpdate(
    {
      ...params.orderFilter,
      "addressHold.state": "open",
      "addressHold.customerConfirmedAt": { $exists: false },
    },
    { $set: { "addressHold.customerConfirmedAt": new Date() } },
    { returnDocument: "after" },
  ).lean<HoldOrder | null>();
  if (!order) {
    // Already said so: the answer stands, and the store is not told twice.
    return Order.findOne({ ...params.orderFilter, "addressHold.state": "open" })
      .select("orderNumber status addressHold")
      .lean<HoldOrder | null>();
  }

  await auditAddressHold(contextOf(params.actor), order, {
    event: "customer_confirmed",
    summary: "Customer confirmed the delivery address is correct as it is",
  });
  const { notifyAdminsAddressHold } = await import("@/lib/notifications/notifications");
  await notifyAdminsAddressHold({
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    kind: "customer_confirmed",
  });
  return order;
}

/** Give the customer more time, and tell them. */
export async function extendAddressHold(params: {
  orderId: unknown;
  days: number;
  actor?: Actor;
  settings?: ISettings;
}): Promise<{ extended: boolean; deadlineAt?: Date }> {
  const days = Math.min(60, Math.max(1, Math.round(params.days)));
  const order = await Order.findOne({ _id: params.orderId, "addressHold.state": "open" })
    .select("orderNumber addressHold")
    .lean<HoldOrder | null>();
  if (!order?.addressHold) return { extended: false };

  const base = Math.max(
    Date.now(),
    order.addressHold.deadlineAt ? new Date(order.addressHold.deadlineAt).getTime() : 0,
  );
  const deadlineAt = new Date(base + days * 24 * 60 * 60 * 1000);
  const updated = await Order.updateOne(
    { _id: params.orderId, "addressHold.state": "open" },
    {
      $set: { "addressHold.deadlineAt": deadlineAt },
      $unset: { "addressHold.expiredAt": "" },
    },
  );
  if (!updated.modifiedCount) return { extended: false };

  await auditAddressHold(contextOf(params.actor), order, {
    event: "extended",
    summary: `Address deadline extended by ${days} day${days === 1 ? "" : "s"} to ${formatDay(deadlineAt)}`,
  });
  await requestAddressCorrection({
    orderId: params.orderId,
    actor: params.actor,
    settings: params.settings,
  });
  return { extended: true, deadlineAt };
}

/**
 * Reminders and deadlines for every open hold. Called from the carrier cron.
 *
 * A passed deadline is stamped once (compare-and-set on `expiredAt`) and then
 * either cancels the order — refunding through the customer-cancel cascade —
 * or tells the store, as the store chose. A customer who said the address is
 * right as it is is never cancelled here, whatever the store chose: the courier
 * refused that address and the customer stands by it, which only a person can
 * settle. Shopify's fulfilment holds, likewise, last until the merchant
 * releases them or cancels the order.
 */
export async function processAddressHolds(
  params: { limit?: number; settings?: ISettings; now?: Date } = {},
): Promise<{ reminders: number; expired: number; cancelled: number }> {
  const settings = params.settings ?? (await getSettings());
  const config = resolveAddressHoldSettings(settings.shipping?.addressHold);
  const now = params.now ?? new Date();
  const counts = { reminders: 0, expired: 0, cancelled: 0 };

  const orders = await Order.find({
    "addressHold.state": "open",
    "addressHold.requestedAt": { $exists: true },
    "addressHold.expiredAt": { $exists: false },
  })
    .select("orderNumber status addressHold")
    .sort({ "addressHold.lastRequestAt": 1 })
    .limit(params.limit ?? 50)
    .lean<HoldOrder[]>();

  for (const order of orders) {
    const due = addressHoldDue(order.addressHold, config, now);
    if (due.kind === "reminder") {
      const result = await requestAddressCorrection({
        orderId: order._id,
        settings,
        reminder: {
          number: due.number,
          sentBefore: Math.max(1, Number(order.addressHold?.requestsSent) || 1),
        },
      }).catch((error) => {
        console.error("Failed to send an address reminder:", error);
        return { sent: false };
      });
      if (result.sent) counts.reminders += 1;
      continue;
    }
    if (due.kind !== "deadline") continue;

    const stamped = await Order.updateOne(
      {
        _id: order._id,
        "addressHold.state": "open",
        "addressHold.expiredAt": { $exists: false },
      },
      { $set: { "addressHold.expiredAt": now } },
    );
    if (!stamped.modifiedCount) continue;
    counts.expired += 1;

    if (
      config.onDeadline === "cancel" &&
      !order.addressHold?.customerConfirmedAt &&
      (await cancelAtDeadline(order))
    ) {
      counts.cancelled += 1;
      continue;
    }

    const confirmed = await customerConfirmedAddress(order);
    await auditAddressHold(createSystemAuditContext(), order, {
      event: "expired",
      summary: confirmed
        ? "Address deadline passed — the customer says the address is correct, and the store has not decided"
        : "Address deadline passed — the customer did not correct the address",
    });
    const { notifyAdminsAddressHold } = await import("@/lib/notifications/notifications");
    await notifyAdminsAddressHold({
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      kind: confirmed ? "deadline_confirmed" : "deadline",
    });
  }

  return counts;
}

/**
 * Whether the customer has said the address is right, read again from the
 * order: the answer can land while the deadline is being processed.
 */
async function customerConfirmedAddress(order: HoldOrder): Promise<boolean> {
  if (order.addressHold?.customerConfirmedAt) return true;
  const fresh = await Order.findOne({ _id: order._id })
    .select("addressHold.customerConfirmedAt")
    .lean<HoldOrder | null>();
  return Boolean(fresh?.addressHold?.customerConfirmedAt);
}

/** What `cancelOrderForCustomer` reports about the money, where it took any. */
type DeadlineRefund = {
  refunded: boolean;
  amount?: number;
  currency?: string;
  reason?: string;
  failed?: boolean;
};

/**
 * Money the cancellation could not give back by itself: the gateway refused
 * the refund, or the refund never ran. The same test the shopper's own cancel
 * screen makes (`preorder-manage-view.tsx`). Any other refusal (nothing was
 * collected, already refunded) owes nothing.
 */
function refundStillOwed(refund: DeadlineRefund | undefined): boolean {
  return Boolean(
    refund && !refund.refunded && (typeof refund.amount === "number" || refund.failed),
  );
}

async function cancelAtDeadline(order: HoldOrder): Promise<boolean> {
  const { cancelOrderForCustomer } = await import("@/lib/orders/customer-cancel");
  let refund: DeadlineRefund | undefined;
  try {
    const result = await cancelOrderForCustomer({
      // Only while the customer still has not answered. One who confirms the
      // address at this very moment keeps the order, and the store is told.
      orderFilter: { _id: order._id, "addressHold.customerConfirmedAt": { $exists: false } },
      auditContext: createSystemAuditContext(),
      reason: "The delivery address was never corrected",
      by: "system",
      allowedStatuses: HOLDABLE_STATUSES,
    });
    if (!result) return false;
    refund = result.refund;
  } catch (error) {
    // The order moved on (shipped by hand, cancelled by someone else): the
    // store is told instead, which is the conservative outcome.
    console.error("Failed to cancel an order at its address deadline:", error);
    return false;
  }

  await releaseAddressHold({ orderId: order._id, reason: "order_cancelled" });
  const { notifyAddressHoldCustomer, notifyAdminsPaymentAnomaly } = await import(
    "@/lib/notifications/notifications"
  );
  // Nobody is watching a cron. A refund that did not go through would stay
  // with the store unseen, while the customer read that it was on its way.
  const owed = refundStillOwed(refund);
  if (owed) {
    const what =
      typeof refund?.amount === "number"
        ? `the refund of ${refund.amount} ${refund.currency || ""}`.trim()
        : "its refund";
    await notifyAdminsPaymentAnomaly({
      title: "Refund to send by hand",
      message: `Order #${order.orderNumber} was cancelled when its address deadline passed, but ${what} did not go through${
        refund?.reason ? ` (${refund.reason})` : ""
      }. Retry it from the order, or send it by hand and record that there.`,
      link: `/admin/orders/${String(order._id)}`,
      dedupeKey: `address-hold:refund-owed:${String(order._id)}`,
    });
  }
  await notifyAddressHoldCustomer({
    orderId: String(order._id),
    kind: "cancelled",
    refundOwed: owed,
  }).catch((error) =>
    console.error("Failed to tell a customer their order was cancelled:", error),
  );
  return true;
}

/**
 * Check the address of recent orders once, before anyone tries to buy a label.
 * Called from the carrier cron. An address checked is keyed, so it is not
 * re-checked (or re-billed) until it changes.
 */
export async function sweepAddressChecks(
  params: { limit?: number; settings?: ISettings } = {},
): Promise<{ checked: number; held: number }> {
  const settings = params.settings ?? (await getSettings());
  const config = resolveAddressHoldSettings(settings.shipping?.addressHold);
  if (!config.checkAfterOrder) return { checked: 0, held: 0 };
  // With no courier to refuse a label, the format check alone would hold
  // orders a store ships by hand — a missing postcode where checkout lets
  // postcodes be optional is not an undeliverable address to them.
  const { enabledCarrierProviders } = await import("@/lib/shipping/carriers/credentials");
  if ((await enabledCarrierProviders(settings)).length === 0) return { checked: 0, held: 0 };

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const orders = await Order.find({
    status: { $in: [ORDER_STATUS.PENDING, ORDER_STATUS.PROCESSING] },
    channel: { $ne: "pos" },
    digitalOnly: { $ne: true },
    "fulfillment.method": { $ne: "pickup" },
    "addressHold.state": { $ne: "open" },
    addressCheck: { $exists: false },
    createdAt: { $gte: since },
    // Not a checkout left at a gateway: it was never an order, and checking
    // it bills the carrier for an address nobody is shipping to — then, with
    // "Ask the customer automatically" on, emails a shopper who never paid to
    // correct it.
    ...placedOrderMatch(),
  })
    .select("orderNumber shippingAddress")
    .sort({ createdAt: -1 })
    .limit(params.limit ?? 20)
    .lean<Array<{ _id: unknown; orderNumber: string; shippingAddress?: Record<string, string> }>>();

  const counts = { checked: 0, held: 0 };
  for (const order of orders) {
    const verification = await verifyDeliveryAddress(order.shippingAddress, { settings });
    const recorded = await Order.updateOne(
      { _id: order._id, addressCheck: { $exists: false } },
      {
        $set: {
          addressCheck: {
            key: addressKey(order.shippingAddress),
            checkedAt: new Date(),
            verdict: verification.verdict,
          },
        },
      },
    );
    if (!recorded.modifiedCount) continue;
    counts.checked += 1;

    if (verification.verdict === "invalid") {
      const { placed } = await placeAddressHold({
        orderId: order._id,
        reason: "validation_failed",
        message: verification.messages.join("; ") || "The courier couldn't find this address",
        settings,
      });
      if (placed) counts.held += 1;
    }
  }
  return counts;
}

/** The message shipping paths refuse with while a hold is open. */
export { ADDRESS_HOLD_SHIPPING_BLOCK };
