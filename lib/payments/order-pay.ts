import { createHash } from "node:crypto";
import { Types } from "mongoose";
import type Stripe from "stripe";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import {
  resolvePayPalCredentials,
  resolveStripeCredentials,
} from "@/lib/settings/credentials";
import {
  fetchStripePaymentFee,
  fromStripeAmount,
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { gatewayFeeUpdate } from "@/lib/payments/gateway-fee";
import { assertPaymentMethodSettles } from "@/lib/payments/gateway-currencies";
import {
  amountDueNow,
  finalizeCapturedOrder,
  type SettingsDocument,
} from "@/lib/payments/finalize-order";
import { orderContactEmail } from "@/lib/orders/order-contact-email";

/**
 * Paying for an order whose payment never arrived — Shopify's "Pay now".
 *
 * A payment that fails after the order exists (a mobile-money push nobody
 * approved, a bank transfer that never came, a redirect the shopper left) does
 * not delete the order: the order number, the items, the address and the
 * prices are all settled, and the only thing missing is the money. Shopify's
 * answer is a link in the failure email that collects exactly that, against
 * the same order. Ours is this module.
 *
 * What it deliberately is NOT:
 *
 *  - not a second checkout — no cart is rebuilt, no prices are re-read, no new
 *    order number is minted, so a shopper who paid through this link has the
 *    order they were promised rather than a lookalike at today's prices;
 *  - not a way to pay a pre-order balance, which is its own flow with its own
 *    link (`preorder-balance.ts`) because it collects PART of an order that is
 *    already partly paid. This one collects an order's first and only payment;
 *  - not a login. The signed link authorises paying this one order and nothing
 *    else, and it runs out after a week (`createOrderPayToken`).
 *
 * The money path itself is the ordinary one: `finalizeCapturedOrder` settles
 * the order exactly as it would if the original gateway had come good, so
 * stock, ledger, emails, vendor payouts and audit are the same events in the
 * same order. The only difference recorded is the method that finally paid.
 */

/** Stripe metadata kind, so the webhook routes these away from checkout. */
export const ORDER_PAY_CHECKOUT_KIND = "order_pay";

/**
 * The payment states a pay link can act on.
 *
 * `expired` is included on purpose: the sweep writes it when a gateway has
 * confirmed nothing arrived, and a shopper who then wants to pay is welcome to
 * — the goods were only ever released, not sold to somebody else. Anything
 * already paid, partly paid or refunded is out, and so is a cancelled order:
 * taking money for one would be collecting for goods nobody will send.
 */
const PAYABLE_PAYMENT_STATUSES: string[] = [
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.EXPIRED,
];

/**
 * The methods a pay link is offered for.
 *
 * Cash on delivery and pay-later are `pending` by design — the shopper has not
 * failed to pay, they have agreed to pay later — so a link asking them for
 * money now would be a store chasing its own terms. A POS sale is settled at
 * the counter. Everything else is a payment that was meant to arrive and did
 * not, which is exactly what this is for, including a bank transfer that never
 * turned up.
 */
const UNPAYABLE_METHODS = new Set(["cod", "cash_on_delivery", "pay_later"]);

export type PayableOrder = {
  _id: unknown;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  channel?: string;
  currency?: string;
  total?: number;
  preorderOutstandingAmount?: number;
  /** The store credit that pays the rest — see `amountDueNow`. */
  storeCredit?: { applied?: number | null; state?: string | null } | null;
  customerId?: unknown;
  guestEmail?: string;
  customerEmail?: string;
};

/** What this order still needs before it can be fulfilled. */
export function getOrderPayAmountDue(order: PayableOrder): number {
  if (!isOrderPayable(order)) return 0;
  return amountDueNow(order);
}

/** Whether a pay link may collect anything for this order at all. */
export function isOrderPayable(order: PayableOrder): boolean {
  if (String(order.status || "") === ORDER_STATUS.CANCELLED) return false;
  if (!PAYABLE_PAYMENT_STATUSES.includes(String(order.paymentStatus || ""))) {
    return false;
  }
  if (String(order.channel || "") === "pos") return false;
  return !UNPAYABLE_METHODS.has(String(order.paymentMethod || "").toLowerCase());
}

/**
 * The order behind a pay link or an account session.
 *
 * Two ways in and exactly two, as on the balance routes: the caller is signed
 * in and the order is theirs, or they hold a link signed for this order. The
 * second is what makes this work for a guest at all — their order names a cart
 * rather than a user, so no session can ever speak for it.
 */
async function loadPayableOrder(params: {
  orderId: string;
  customerId?: string;
  viaAccessLink?: boolean;
}): Promise<PayableOrder> {
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
  )
    .select(
      "orderNumber status paymentStatus paymentMethod channel currency total preorderOutstandingAmount storeCredit customerId guestEmail customerEmail",
    )
    .lean()) as PayableOrder | null;
  if (!order) throw new ValidationError("Order not found");
  return order;
}

function stripeClientFor(settings: SettingsDocument) {
  const stripeSettings = settings.payment?.stripe;
  if (!stripeSettings?.enabled) {
    throw new ValidationError("Card payments are not available right now");
  }
  const secretKey = resolveStripeCredentials(stripeSettings).secretKey;
  if (!isStripeSecretKeyConfigured(secretKey)) {
    throw new ValidationError("Card payments are not configured");
  }
  return getStripeForSecretKey(secretKey);
}

function orderCurrency(order: PayableOrder, settings: SettingsDocument) {
  return String(order.currency || settings.general?.defaultCurrency || "USD")
    .trim()
    .toUpperCase();
}

type OrderPayIntentResult =
  | { alreadyPaid: true }
  | {
      alreadyPaid?: false;
      clientSecret: string;
      paymentIntentId: string;
      amount: number;
      currency: string;
    };

/**
 * A card payment for everything this order still owes.
 *
 * One intent per order, held by Stripe's own idempotency key rather than a
 * column on the order: the amount cannot change while the order is unpaid, so
 * every click and every reload asks for the same intent back. A card that was
 * refused leaves it in `requires_payment_method`, which is precisely the state
 * a second card can be tried against — the shopper is not handed a fresh
 * intent each time, and there is never more than one chargeable intent for
 * one order.
 */
export async function createOrderPayIntent(params: {
  orderId: string;
  customerId?: string;
  viaAccessLink?: boolean;
  customerEmail?: string;
  settings?: SettingsDocument;
}): Promise<OrderPayIntentResult> {
  const order = await loadPayableOrder(params);
  if (!isOrderPayable(order)) {
    // Paid while the page was open, or cancelled under it. Either way there is
    // nothing to collect, and asking for money would be the wrong answer to
    // both.
    return { alreadyPaid: true };
  }

  const settings = params.settings || (await getSettings());
  const stripe = stripeClientFor(settings);
  const currency = orderCurrency(order, settings);
  const due = getOrderPayAmountDue(order);
  const amount = toStripeAmount(due, currency);
  if (!(amount > 0)) return { alreadyPaid: true };
  // The order's own currency, not the store's: it was frozen when the order
  // was placed, and a store that has since changed currency still owes it.
  assertPaymentMethodSettles("card", currency);

  // The receipt goes to the address the order was placed under, whoever opens
  // the link. It used to come from the session, so one link opened signed out
  // and then signed in sent Stripe two different requests under one
  // idempotency key; Stripe refused the second, the shopper saw its raw error
  // (key and all), and the link could not take a card for a day. The session's
  // address is only the fallback for an order that recorded none.
  const receiptEmail =
    (await orderContactEmail(order)) || params.customerEmail || undefined;

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        description: `Order ${order.orderNumber || ""} payment`.trim(),
        metadata: {
          kind: ORDER_PAY_CHECKOUT_KIND,
          orderId: String(order._id),
          orderNumber: String(order.orderNumber || ""),
        },
        ...(receiptEmail ? { receipt_email: receiptEmail } : {}),
      },
      // Two concurrent clicks get the same intent from Stripe rather than two
      // chargeable ones. Keyed on the order and the amount so that a partial
      // refund or an edit that changed what is owed cannot reuse an intent for
      // the old figure — and on the receipt address, so that a request can
      // never differ from the one first sent under its key.
      {
        idempotencyKey: `order-pay:${String(order._id)}:${amount}:${currency}:${receiptKey(receiptEmail)}`,
      },
    );
  } catch (error) {
    // Stripe's own text names the idempotency key and other internals; the
    // shopper is told what they can do instead.
    console.error(
      `Failed to start a pay-link card payment for order ${String(order._id)}:`,
      error,
    );
    throw new ValidationError(
      "Card payment could not be started. Please try again in a moment.",
    );
  }

  if (!intent.client_secret) {
    throw new ValidationError("Card payment could not be started");
  }

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    amount: due,
    currency,
  };
}

/** A receipt address as it appears in an idempotency key: hashed, never raw. */
function receiptKey(email: string | undefined): string {
  if (!email) return "none";
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

type OrderPaySettlement =
  | { settled: true; alreadyPaid?: boolean; orderId: string }
  | { settled: false; reason: "not_ours" | "not_succeeded" | "mismatch" | "gone" };

/**
 * Record a pay-link card payment against its order.
 *
 * Called from two places that race each other — the shopper's confirm call and
 * Stripe's webhook — and safe either way: `finalizeCapturedOrder` guards its
 * write on the order still being unpaid, so whichever lands first does the
 * work and the other is told it was already paid.
 */
export async function settleOrderPayIntent(
  intent: Stripe.PaymentIntent,
  settings?: SettingsDocument,
): Promise<OrderPaySettlement> {
  const metadata = (intent.metadata || {}) as Record<string, string | undefined>;
  if (metadata.kind !== ORDER_PAY_CHECKOUT_KIND) {
    return { settled: false, reason: "not_ours" };
  }
  const orderId = String(metadata.orderId || "");
  if (!Types.ObjectId.isValid(orderId)) {
    return { settled: false, reason: "gone" };
  }
  if (intent.status !== "succeeded") {
    return { settled: false, reason: "not_succeeded" };
  }

  const resolved = settings || (await getSettings());
  const currency = String(intent.currency || "").toUpperCase();
  const paid = fromStripeAmount(Number(intent.amount_received || intent.amount), currency);

  let result;
  try {
    result = await finalizeCapturedOrder({
    provider: {
      // The method the order carried is the one that FAILED. What settles it
      // is a card, and the refund, custody and payout rules all read this
      // field, so it is corrected in the same write that records the money.
      paymentMethod: "card",
      label: "Card",
      recoveryGateway: "stripe",
    },
    // Deliberately ignores the scope's `paymentMethod`: the whole point of a
    // pay link is that a card settles an order raised against another gateway.
    findOrder: () => Order.findOne({ _id: orderId }),
    notFoundMessage: "Order not found for this payment",
    verify: async (order) => {
      const expected = toStripeAmount(
        amountDueNow(order as unknown as PayableOrder),
        String(order.currency || currency).toUpperCase(),
      );
      const received = Number(intent.amount_received || intent.amount || 0);
      if (
        String(order.currency || currency).toUpperCase() !== currency ||
        received < expected
      ) {
        // Short or in the wrong currency: recording it as payment in full
        // would ship goods for money that never covered them.
        throw new ValidationError(
          "This payment does not match what the order owes",
        );
      }
      const fee = await fetchStripePaymentFee(
        stripeClientFor(resolved),
        intent.id,
      );
      return {
        paymentId: intent.id,
        paymentUpdate: {
          paymentMethod: "card",
          ...gatewayFeeUpdate(fee),
        },
      };
    },
      settings: resolved,
      customerEmail: intent.receipt_email || undefined,
      // What the failed payment's email offered, and what brought it back.
      recoveredVia: "pay_link",
    });
  } catch (error) {
    // The card was charged on the shopper's browser before this ran, so a
    // refusal here is money this store is holding and cannot account for.
    // Saying so is the whole job: the webhook will retry, and meanwhile a
    // person can see the charge and decide.
    console.error(
      `Failed to settle a pay-link payment for order ${orderId} (${paid} ${currency}):`,
      error,
    );
    await reportUnrecordablePayLinkCharge({
      intent,
      orderId,
      amount: paid,
      currency,
      why: error instanceof Error ? error.message : "unknown error",
      refunded: false,
    });
    throw error;
  }

  // Paid twice: this card went through while the payment the order was
  // waiting for finally landed — a mobile-money push approved late, a webhook
  // that arrived while the shopper was typing their card. The order owes
  // nothing, so this money is not ours to keep.
  //
  // Only the card path can reach this. PayPal's twin captures INSIDE `verify`,
  // which `finalizeCapturedOrder` never reaches on an order already paid, so
  // its approval simply lapses with nothing taken.
  if (result.alreadyPaid) {
    await refundDuplicatePayLinkCharge({
      intent,
      orderId,
      amount: paid,
      currency,
      settings: resolved,
    });
  }

  return {
    settled: true,
    alreadyPaid: result.alreadyPaid,
    orderId: result.orderId,
  };
}

/**
 * Send back a pay-link charge the order turned out not to need, and say so.
 *
 * Refunded rather than kept, and announced either way: a shopper who paid
 * twice for one order notices, and a merchant who has to explain it needs to
 * have been told first.
 */
async function refundDuplicatePayLinkCharge(params: {
  intent: Stripe.PaymentIntent;
  orderId: string;
  amount: number;
  currency: string;
  settings: SettingsDocument;
}): Promise<void> {
  let refunded = false;
  try {
    await stripeClientFor(params.settings).refunds.create({
      payment_intent: params.intent.id,
      reason: "duplicate",
    });
    refunded = true;
  } catch (error) {
    console.error(
      `Failed to refund a duplicate pay-link charge (${params.intent.id}):`,
      error,
    );
  }

  const { recordChargeFailure } = await import(
    "@/lib/payments/payment-transactions"
  );
  // `cancelled`, not `failed`: the card worked, the money simply did not stay.
  // Recorded as a charge that collected nothing rather than as a refund on the
  // order, which would tell the ledger the shopper had money back for goods.
  await recordChargeFailure({
    provider: "stripe",
    paymentMethod: "card",
    orderId: params.orderId,
    externalId: params.intent.id,
    amount: params.amount,
    currency: params.currency,
    status: "cancelled",
    failureCode: "duplicate_payment",
    gatewayMessage: refunded
      ? "Paid twice; this charge was refunded automatically."
      : "Paid twice; the automatic refund failed.",
    source: "webhook",
    dedupeKey: `order-pay-duplicate:${params.intent.id}`,
  });

  await reportUnrecordablePayLinkCharge({
    intent: params.intent,
    orderId: params.orderId,
    amount: params.amount,
    currency: params.currency,
    why: "the order had already been paid for",
    refunded,
  });
}

/** Tell the admins about money taken that the order could not account for. */
async function reportUnrecordablePayLinkCharge(params: {
  intent: Stripe.PaymentIntent;
  orderId: string;
  amount: number;
  currency: string;
  why: string;
  refunded: boolean;
}): Promise<void> {
  const { notifyAdminsPaymentAnomaly } = await import(
    "@/lib/notifications/notifications"
  );
  await notifyAdminsPaymentAnomaly({
    title: params.refunded
      ? "Duplicate payment link charge refunded"
      : "A payment link charge could not be applied",
    message: `${params.amount} ${params.currency} was charged through a payment link for order ${params.orderId}, and ${params.why}. ${
      params.refunded
        ? "It has been refunded automatically; no action is needed unless the shopper says otherwise."
        : `Check Stripe payment ${params.intent.id} and refund it by hand if the order does not need it.`
    }`,
    paymentIntentId: params.intent.id,
    // One notice per charge, however many times the webhook retries.
    dedupeKey: `order-pay-anomaly:${params.intent.id}`,
  }).catch((error) =>
    console.error("Failed to raise a pay-link payment anomaly:", error),
  );
}

/* ------------------------------------------------------------------ */
/* PayPal                                                              */
/* ------------------------------------------------------------------ */

type OrderPayPayPalResult =
  | { alreadyPaid: true }
  | { alreadyPaid?: false; approvalUrl: string; paypalOrderId: string };

function payPalCredentialsFor(settings: SettingsDocument) {
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

/**
 * Raise a PayPal order for what this order still owes.
 *
 * The approval is recorded in its own field rather than the checkout's, so the
 * two never fight over one reference; a fresh attempt simply replaces an
 * abandoned one, which costs nobody anything because PayPal moves no money
 * until this app captures.
 *
 * The return and cancel URLs come from the caller's own request and never from
 * a request body, so this cannot be turned into an open redirect.
 */
export async function createOrderPayPayPalOrder(params: {
  orderId: string;
  customerId?: string;
  viaAccessLink?: boolean;
  returnUrl: string;
  cancelUrl: string;
  settings?: SettingsDocument;
}): Promise<OrderPayPayPalResult> {
  const order = await loadPayableOrder(params);
  if (!isOrderPayable(order)) return { alreadyPaid: true };

  const settings = params.settings || (await getSettings());
  const creds = payPalCredentialsFor(settings);
  const due = getOrderPayAmountDue(order);
  if (!(due > 0)) return { alreadyPaid: true };

  const currency = orderCurrency(order, settings);
  assertPaymentMethodSettles("paypal", currency);

  const { createPayPalOrder } = await import("@/lib/payments/paypal");
  const { orderId: paypalOrderId, approvalUrl } = await createPayPalOrder({
    creds,
    currency,
    total: due,
    returnUrl: params.returnUrl,
    cancelUrl: params.cancelUrl,
    // Tells a pay-link approval apart from a checkout's in PayPal's own
    // dashboard, where support questions are answered.
    referenceId: `PAY-${String(order._id)}`,
  });

  // Guarded on the order still being unpaid: a card payment that landed while
  // the PayPal order was being raised must not leave a second way to pay.
  const stamped = await Order.updateOne(
    {
      _id: order._id,
      status: { $ne: ORDER_STATUS.CANCELLED },
      paymentStatus: { $in: PAYABLE_PAYMENT_STATUSES },
    },
    { $set: { payLinkPaypalOrderId: paypalOrderId } },
  );
  if (!stamped.matchedCount) return { alreadyPaid: true };

  return { approvalUrl, paypalOrderId };
}

/**
 * Capture a "pay now" PayPal approval and record it on its order.
 *
 * Returns `notOurs` when the PayPal order belongs to something else — a
 * checkout, a balance, a vendor's subscription — so the capture route can hand
 * it on rather than failing a payment the shopper has already approved.
 *
 * The capture happens INSIDE `verify`, which is what makes this safe: an order
 * cancelled while the shopper was at PayPal is never captured at all, rather
 * than captured and then refunded onto their statement twice over.
 */
export async function settleOrderPayFromPayPal(params: {
  paypalOrderId: string;
  settings?: SettingsDocument;
  sessionUserId?: string;
  customerEmail?: string;
}): Promise<
  | { notOurs: true }
  | { notOurs?: false; orderId: string; orderNumber: string; alreadyPaid: boolean }
> {
  const existing = await Order.findOne({
    payLinkPaypalOrderId: params.paypalOrderId,
  })
    .select("_id")
    .lean<{ _id: unknown } | null>();
  if (!existing) return { notOurs: true };

  const settings = params.settings || (await getSettings());
  const creds = payPalCredentialsFor(settings);
  const { captureOrReadPayPalOrder } = await import("@/lib/payments/paypal");
  const { paypalFee } = await import("@/lib/payments/gateway-fee");

  const result = await finalizeCapturedOrder({
    provider: {
      paymentMethod: "paypal",
      label: "PayPal",
      recoveryGateway: "paypal",
      capturesOnVerify: true,
    },
    // By the PayPal reference alone, for the same reason the card path does:
    // the order's own method is the one that failed.
    findOrder: () =>
      Order.findOne({ payLinkPaypalOrderId: params.paypalOrderId }),
    notFoundMessage: "Order not found for PayPal capture",
    verify: async (order) => {
      const capture = await captureOrReadPayPalOrder({
        creds,
        orderId: params.paypalOrderId,
      });
      if (!capture.captureId) {
        throw new ValidationError("PayPal capture failed: missing capture id");
      }

      const first = capture.raw?.purchase_units?.[0]?.payments?.captures?.[0];
      // The CAPTURE's status, never the order's: PayPal marks an order
      // COMPLETED while holding the capture PENDING, and a pending capture
      // can still be denied.
      if (first?.status !== "COMPLETED") {
        throw new ValidationError(
          `PayPal payment not completed yet: ${first?.status || "unknown"}`,
        );
      }
      const capturedAmount = first?.amount?.value;
      const capturedCurrency = first?.amount?.currency_code;
      if (
        typeof capturedAmount !== "string" ||
        typeof capturedCurrency !== "string"
      ) {
        throw new ValidationError(
          "PayPal capture response is missing amount details",
        );
      }

      const expectedCurrency = String(
        order.currency || settings.general?.defaultCurrency || "USD",
      ).toUpperCase();
      if (capturedCurrency !== expectedCurrency) {
        throw new ValidationError("PayPal currency mismatch");
      }
      const capturedCents = Math.round(Number(capturedAmount) * 100);
      const expectedCents = Math.round(amountDueNow(order) * 100);
      if (!Number.isFinite(capturedCents) || capturedCents !== expectedCents) {
        throw new ValidationError("PayPal amount mismatch");
      }

      return {
        paymentId: capture.captureId,
        paymentUpdate: {
          paymentMethod: "paypal",
          paypalCaptureId: capture.captureId,
          ...gatewayFeeUpdate(paypalFee(capture.raw)),
        },
        customerEmail: capture.raw?.payer?.email_address || undefined,
      };
    },
    settings,
    sessionUserId: params.sessionUserId,
    customerEmail: params.customerEmail,
    recoveredVia: "pay_link",
  });

  return {
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    alreadyPaid: result.alreadyPaid,
  };
}
