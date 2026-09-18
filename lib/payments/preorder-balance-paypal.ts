import { Types } from "mongoose";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { resolvePayPalCredentials } from "@/lib/settings/credentials";
import {
  capturePayPalOrder,
  createPayPalOrder,
  readPayPalOrderCapture,
  refundPayPalCapture,
  type PayPalCredentials,
} from "@/lib/payments/paypal";
import { paypalFee } from "@/lib/payments/gateway-fee";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import { PAYPAL_BALANCE_REFERENCE_PREFIX } from "@/lib/payments/preorder-balance-reference";
import {
  balanceFeeUpdate,
  claimPreorderBalance,
  runPreorderBalanceSettledEffects,
} from "@/lib/payments/preorder-balance";

/**
 * Collecting a pre-order balance through PayPal.
 *
 * Until this, a balance could only ever be collected by card, so a store that
 * took PayPal took it for everything except the one payment that pre-orders
 * exist for. The shape is the card flow's, redirected: the shopper asks to pay,
 * this raises a PayPal order for exactly the balance, PayPal sends them back
 * approved, and the capture route settles it — through the same claim and the
 * same settled effects the card and the offline paths use, because the money
 * is the same money however it arrived.
 *
 * **PayPal moves money only on the capture call this app makes** — not on
 * approval, and never on its own. That is the one real difference from Stripe,
 * and it is used: every check that the Stripe path has to make AFTER the money
 * is taken (and answer with a refund), this makes BEFORE capturing, so a
 * balance that was paid by card in the meantime, or an order cancelled while
 * the shopper was away at PayPal, simply never gets charged.
 *
 * What cannot be checked in advance is still never dropped: a capture that
 * lands and then cannot be recorded is refunded and put in front of an admin,
 * exactly as `refundUnrecordableBalance` does for a card.
 *
 * Customer-present only. Charging a PayPal account again without the shopper
 * needs PayPal's Vault, which a merchant has to be approved for separately — so
 * a PayPal balance is asked for, never taken off-session, and the off-session
 * charge (`preorder-balance-charge.ts`) leaves these orders to the reminder.
 */

type SettingsDocument = Awaited<ReturnType<typeof getSettings>>;

type PayPalBalanceOrder = {
  _id: unknown;
  orderNumber: string;
  customerId?: unknown;
  currency?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentFee?: number;
  paymentFeeCurrency?: string;
  paymentFeeRate?: number;
  total?: number;
  preorderOutstandingAmount?: number;
  preorderBalancePaymentIntentId?: string;
  preorderBalancePaidAt?: Date | null;
  preorderBalancePaypalOrderId?: string;
  subOrders?: Array<{
    status?: string;
    items?: Array<{ preorderOutstandingAmount?: number | null }> | null;
  }> | null;
};

function payPalCredentialsFor(settings: SettingsDocument): PayPalCredentials {
  const paypal = settings.payment?.paypal;
  if (!paypal?.enabled) {
    throw new ValidationError("PayPal is not available right now");
  }
  const creds = resolvePayPalCredentials(paypal);
  if (!creds.clientId || !creds.clientSecret) {
    throw new ValidationError("PayPal is not configured");
  }
  return {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    mode: creds.mode,
  };
}

function orderCurrency(order: PayPalBalanceOrder, settings: SettingsDocument) {
  return String(order.currency || settings.general?.defaultCurrency || "USD")
    .trim()
    .toUpperCase();
}

/** Money compared in hundredths, as the PayPal checkout capture compares it. */
function hundredths(value: unknown) {
  const parsed = Math.round(Number(value) * 100);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export type PayPalBalanceOrderResult =
  | { alreadyPaid: true }
  | { alreadyPaid?: false; approvalUrl: string; paypalOrderId: string };

/**
 * Raise a PayPal order for exactly the balance still owed.
 *
 * Reached the two ways the card balance route is: by the signed-in shopper the
 * order belongs to, or by a holder of the signed balance link. The return and
 * cancel URLs are the caller's to build — from its own request and never from
 * the body, so this cannot be turned into an open redirect.
 */
export async function createPreorderBalancePayPalOrder(params: {
  orderId: string;
  /** The signed-in shopper, when there is one. The order must be theirs. */
  customerId?: string;
  /** The caller proved themselves with a balance link instead. */
  viaAccessLink?: boolean;
  returnUrl: string;
  cancelUrl: string;
  settings?: SettingsDocument;
}): Promise<PayPalBalanceOrderResult> {
  if (!Types.ObjectId.isValid(params.orderId)) {
    throw new ValidationError("Order not found");
  }
  if (!params.viaAccessLink && !params.customerId) {
    throw new ValidationError("Order not found");
  }
  const order = (await Order.findOne(
    params.viaAccessLink
      ? { _id: params.orderId }
      : { _id: params.orderId, customerId: params.customerId },
  ).lean()) as PayPalBalanceOrder | null;
  if (!order) throw new ValidationError("Order not found");

  const balanceDue = getPreorderBalanceDue(order);
  if (balanceDue <= 0) {
    if (order.preorderBalancePaidAt) return { alreadyPaid: true };
    throw new ValidationError("There is no balance due on this order");
  }

  const settings = params.settings || (await getSettings());
  const creds = payPalCredentialsFor(settings);

  const { orderId: paypalOrderId, approvalUrl } = await createPayPalOrder({
    creds,
    currency: orderCurrency(order, settings),
    total: balanceDue,
    returnUrl: params.returnUrl,
    cancelUrl: params.cancelUrl,
    // Distinguishable at a glance in the PayPal dashboard from a checkout,
    // whose reference is the cart.
    referenceId: `PBAL-${String(order._id)}`,
  });

  // Recorded so the return from PayPal can find this order. A newer attempt
  // simply replaces an abandoned one: PayPal takes nothing until this app
  // captures, so an approval nobody returns from costs nobody anything. Guarded
  // on the balance still being owed, so a card payment that landed while the
  // PayPal order was being raised is not given a second way to be paid.
  const stamped = await Order.updateOne(
    {
      _id: order._id,
      status: { $ne: ORDER_STATUS.CANCELLED },
      $or: [
        { preorderBalancePaidAt: null },
        { preorderBalancePaidAt: { $exists: false } },
      ],
    },
    { $set: { preorderBalancePaypalOrderId: paypalOrderId } },
  );
  if (!stamped.matchedCount) {
    return { alreadyPaid: true };
  }

  return { approvalUrl, paypalOrderId };
}

export type SettlePayPalBalanceResult = {
  settled: boolean;
  orderId?: string;
  orderNumber?: string;
  /** Nothing was done because the balance was already recorded. */
  alreadySettled?: boolean;
  reason?: string;
};

/**
 * Refund a PayPal capture this app took and cannot record, and say so.
 *
 * The PayPal twin of `refundUnrecordableBalance`. Only reached AFTER a capture,
 * so it is only reached for what could not be ruled out before one — every
 * check that could be made in advance already stopped the capture happening.
 */
async function refundUnrecordablePayPalBalance(params: {
  creds: PayPalCredentials;
  captureId: string;
  amount: string;
  currency: string;
  orderNumber: string;
  why: string;
}): Promise<void> {
  let refunded = false;
  try {
    // No amount: the whole capture goes back, which is all of it by definition.
    await refundPayPalCapture({
      creds: params.creds,
      captureId: params.captureId,
      reason: "Pre-order balance could not be applied",
    });
    refunded = true;
  } catch (err) {
    console.error(
      `Failed to refund an unrecordable PayPal balance (${params.captureId}):`,
      err,
    );
  }

  const { notifyAdminsPaymentAnomaly } = await import(
    "@/lib/notifications/notifications"
  );
  await notifyAdminsPaymentAnomaly({
    title: refunded
      ? "PayPal pre-order balance refunded automatically"
      : "PayPal pre-order balance captured but NOT recorded",
    message: refunded
      ? `A PayPal balance of ${params.amount} ${params.currency} for order #${params.orderNumber} could not be recorded (${params.why}), so it was refunded to the shopper. No action is needed unless the shopper says otherwise.`
      : `A PayPal balance of ${params.amount} ${params.currency} for order #${params.orderNumber} was captured but could not be recorded (${params.why}), and the automatic refund also failed. Refund capture ${params.captureId} from the PayPal dashboard.`,
  }).catch((err) =>
    console.error("Failed to raise a PayPal balance anomaly:", err),
  );
}

/**
 * Capture a shopper's approved PayPal balance and record it on the order.
 *
 * Called from the capture route when PayPal sends the shopper back. Safe to
 * call twice — a page reload, a double click — because the claim decides who
 * records it and a replay finds the balance already paid before it can capture.
 * Returns `reason: "not_a_balance_order"` when the PayPal order is not a
 * balance at all, so the route can hand it on to checkout.
 */
export async function settlePreorderBalanceFromPayPal(params: {
  paypalOrderId: string;
  settings?: SettingsDocument;
}): Promise<SettlePayPalBalanceResult> {
  const order = (await Order.findOne({
    preorderBalancePaypalOrderId: params.paypalOrderId,
  }).lean()) as PayPalBalanceOrder | null;
  if (!order) return { settled: false, reason: "not_a_balance_order" };

  const orderId = String(order._id);
  const orderNumber = order.orderNumber;
  const reference = (captureId: string) =>
    `${PAYPAL_BALANCE_REFERENCE_PREFIX}${captureId}`;

  // Before any money moves. A balance that is no longer owed — paid by card
  // while the shopper was at PayPal, or the order cancelled — is not captured
  // at all, which leaves the shopper's approval to lapse unpaid.
  const balanceDue = getPreorderBalanceDue(order);
  if (balanceDue <= 0) {
    return {
      settled: false,
      orderId,
      orderNumber,
      alreadySettled: Boolean(order.preorderBalancePaidAt),
      reason: order.preorderBalancePaidAt ? "already_paid" : "no_balance_due",
    };
  }

  const settings = params.settings || (await getSettings());
  const creds = payPalCredentialsFor(settings);
  const currency = orderCurrency(order, settings);

  let captureId: string | undefined;
  let captureStatus: string | undefined;
  let captureAmount: string | undefined;
  let captureCurrency: string | undefined;
  let captureRaw: unknown;
  try {
    const capture = await capturePayPalOrder({
      creds,
      orderId: params.paypalOrderId,
    });
    const first = capture.raw?.purchase_units?.[0]?.payments?.captures?.[0];
    captureId = capture.captureId;
    // The capture's own status: the order reads COMPLETED while a capture
    // under review is still PENDING, and could yet be denied.
    captureStatus = String(first?.status || "");
    captureAmount = first?.amount?.value;
    captureCurrency = first?.amount?.currency_code;
    captureRaw = capture.raw;
  } catch (err) {
    // Captured on an earlier attempt that never got as far as recording it.
    // PayPal refuses a second capture, so the one that already happened is
    // read back rather than the money being written off as never taken.
    const existing = await readPayPalOrderCapture({
      creds,
      orderId: params.paypalOrderId,
    }).catch(() => null);
    if (!existing?.captureId) throw err;
    captureId = existing.captureId;
    captureStatus = existing.status;
    captureAmount = existing.amount;
    captureCurrency = existing.currency;
    captureRaw = existing.raw;
  }

  if (!captureId) {
    throw new ValidationError("PayPal capture failed: missing capture id");
  }
  if (String(captureStatus || "").toUpperCase() !== "COMPLETED") {
    throw new ValidationError(
      `PayPal payment not completed: ${captureStatus || "unknown"}`,
    );
  }

  // Re-read after capturing, because the balance can move while the shopper
  // is away at PayPal — a consignment cancelled underneath them lowers it.
  const current = (await Order.findById(order._id).lean()) as PayPalBalanceOrder | null;
  const owedNow = current ? getPreorderBalanceDue(current) : 0;
  if (
    !current ||
    owedNow <= 0 ||
    String(captureCurrency || "").toUpperCase() !== currency ||
    hundredths(captureAmount) !== hundredths(owedNow)
  ) {
    const why = !current || owedNow <= 0
      ? "the order no longer has a balance due"
      : `paid ${captureAmount} ${captureCurrency} against a balance of ${owedNow} ${currency}`;
    // A replay of a capture that was already recorded is not an anomaly.
    if (current?.preorderBalancePaymentIntentId === reference(captureId)) {
      return { settled: false, orderId, orderNumber, alreadySettled: true };
    }
    await refundUnrecordablePayPalBalance({
      creds,
      captureId,
      amount: String(captureAmount || ""),
      currency: String(captureCurrency || currency),
      orderNumber,
      why,
    });
    return { settled: false, orderId, orderNumber, reason: "unrecordable" };
  }

  // A pay-later order took nothing at checkout and carries the `pay_later`
  // method the custody rule reads as the vendor holding the cash — the same
  // reason the card path stamps it `card`. PayPal collected it, so it is the
  // PayPal payment it now is. Deliberately NOT `paypalCaptureId`: that names a
  // DEPOSIT capture, and the refund path would then see this one capture as
  // both the deposit and the balance and try to give it back twice.
  const custodyUpdate =
    current.paymentMethod === "pay_later"
      ? { paymentMethod: "paypal", paymentId: captureId }
      : {};
  const feeUpdate = balanceFeeUpdate(current, paypalFee(captureRaw));

  const claimed = await claimPreorderBalance({
    orderId: current._id,
    reference: reference(captureId),
    now: new Date(),
    extraSet: { ...custodyUpdate, ...feeUpdate },
  });
  if (!claimed) {
    const after = (await Order.findById(order._id).lean()) as PayPalBalanceOrder | null;
    if (
      after?.preorderBalancePaymentIntentId === reference(captureId) &&
      after?.preorderBalancePaidAt
    ) {
      return { settled: false, orderId, orderNumber, alreadySettled: true };
    }
    await refundUnrecordablePayPalBalance({
      creds,
      captureId,
      amount: String(captureAmount || ""),
      currency: String(captureCurrency || currency),
      orderNumber,
      why: "the order changed before the balance could be recorded",
    });
    return { settled: false, orderId, orderNumber, reason: "claim_lost" };
  }

  await runPreorderBalanceSettledEffects({
    claimed,
    settings,
    currency,
    balanceDue: owedNow,
    gatewayLabel: "PayPal",
    transactionId: captureId,
    paymentMetadata: {
      preorderBalancePaypalCaptureId: captureId,
      preorderBalancePaypalOrderId: params.paypalOrderId,
    },
  });

  return { settled: true, orderId, orderNumber };
}
