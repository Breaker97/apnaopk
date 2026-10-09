import type {
  RedirectPaymentMethod,
  RedirectVerification,
} from "@/contracts/mobile/shop/v1/checkout";
import { MobileApiError } from "@/lib/api-core/errors";
import { ApiError, ConflictError, ValidationError } from "@/lib/api/errors";
import type { AppPaymentReference } from "@/lib/checkout/app-payment-reference";
import {
  appPaymentReturnUrl,
  type AppPaymentReturnStatus,
} from "@/lib/checkout/app-payment-return";
import type { GatewayStartRequest } from "@/lib/checkout/gateway-start/attempt";
import { startOrangeMoneyCheckout } from "@/lib/checkout/gateway-start/orange-money";
import { startPayPalCheckout } from "@/lib/checkout/gateway-start/paypal";
import { startPaystackCheckout } from "@/lib/checkout/gateway-start/paystack";
import { startPesapalCheckout } from "@/lib/checkout/gateway-start/pesapal";
import { startRazorpayCheckout } from "@/lib/checkout/gateway-start/razorpay";
import type { GatewayCheckoutRecord } from "@/lib/checkout/gateway-start/types";
import type { CheckoutDraft } from "@/lib/checkout/prepare-checkout";
import type {
  CheckoutPaymentScope,
  SettledCheckoutPayment,
} from "@/lib/payments/checkout-payment-check";
import { CHECKOUT_CLOSED_BEFORE_PAYMENT } from "@/lib/payments/finalize-attempt";
import {
  amountDueNow,
  CANCELLED_BEFORE_CAPTURE,
  isPaymentAlreadyRecorded,
  SOLD_OUT_AFTER_CAPTURE,
  type SettingsDocument,
} from "@/lib/payments/finalize-order";
import { checkOrangeMoneyPayment } from "@/lib/payments/orange-money-verify";
import {
  payPalCheckoutCredentials,
  readPayPalCheckoutState,
  settlePayPalCheckout,
} from "@/lib/payments/paypal-verify";
import { assertPaystackEnabled, checkPaystackPayment } from "@/lib/payments/paystack-verify";
import { checkPesapalPayment } from "@/lib/payments/pesapal-verify";
import {
  checkRazorpayOrderPayments,
  checkRazorpayPayment,
} from "@/lib/payments/razorpay-verify";
import { CheckoutAttempt, Order } from "@/models";

/**
 * The shopper app's payments on a gateway's own page: starting one from a
 * prepared checkout, finding what a reference names, and asking the gateway
 * how it went. Every step is the website's own — the gateway starts in
 * lib/checkout/gateway-start/, the checks and settlements in
 * lib/payments/<provider>-verify.ts — with the return URLs pointing at the
 * app's bridge (lib/checkout/app-payment-return.ts).
 */

export interface RedirectStart {
  record: GatewayCheckoutRecord;
  /** The gateway's page; null for Razorpay, which is paid on the store's pay page. */
  gatewayUrl: string | null;
  resumed: boolean;
}

/** Start the gateway's payment for a prepared checkout, the payer to come back through the bridge. */
export async function startRedirectPayment(
  draft: CheckoutDraft,
  method: RedirectPaymentMethod,
  ctx: { locale: string; request: GatewayStartRequest },
): Promise<RedirectStart> {
  const back = (status: AppPaymentReturnStatus) => appPaymentReturnUrl(ctx.locale, method, status);
  const { request } = ctx;
  switch (method) {
    case "paypal": {
      const [returnUrl, cancelUrl] = await Promise.all([back("return"), back("cancel")]);
      const start = await startPayPalCheckout(draft, { returnUrl, cancelUrl, request });
      return { record: start.record, gatewayUrl: start.approvalUrl, resumed: start.resumed };
    }
    case "razorpay": {
      const start = await startRazorpayCheckout(draft, { request });
      return { record: start.record, gatewayUrl: null, resumed: start.resumed };
    }
    case "paystack": {
      const returnUrl = await back("return");
      const start = await startPaystackCheckout(draft, { callbackUrl: () => returnUrl, request });
      return { record: start.record, gatewayUrl: start.authorizationUrl, resumed: start.resumed };
    }
    case "pesapal": {
      const [returnUrl, cancellationUrl] = await Promise.all([back("return"), back("cancel")]);
      const start = await startPesapalCheckout(draft, { callbackUrl: () => returnUrl, cancellationUrl, request });
      return { record: start.record, gatewayUrl: start.redirectUrl, resumed: start.resumed };
    }
    case "orange_money": {
      const [returnUrl, cancelUrl] = await Promise.all([back("return"), back("cancel")]);
      const start = await startOrangeMoneyCheckout(draft, { returnUrl: () => returnUrl, cancelUrl });
      return { record: start.record, gatewayUrl: start.paymentUrl, resumed: false };
    }
  }
}

/** The gateway's own references, as an order holds them (an attempt holds the same under `gateway`). */
interface GatewayRefs {
  paypalOrderId?: string;
  razorpayOrderId?: string;
  paystackReference?: string;
  pesapalOrderTrackingId?: string;
  pesapalMerchantReference?: string;
  orangeMoneyOrderId?: string;
  orangeMoneyPayToken?: string;
}

/** What a reference names: the record the payment lands on, as far as verifying it needs. */
export interface RedirectRecord {
  kind: AppPaymentReference["kind"];
  /** The order, once there is one: the pending order itself, or the one an attempt became. */
  order?: { id: string; number: string };
  /** The payment is on the order already. */
  paid: boolean;
  /** What the gateway is held to (`amountDueNow`), in `currency`. */
  amountDue: number;
  currency: string;
  gateway: GatewayRefs;
}

type MoneyFields = Parameters<typeof amountDueNow>[0];

type OrderRow = GatewayRefs &
  MoneyFields & {
    _id: unknown;
    orderNumber: string;
    paymentMethod?: string;
    paymentStatus?: string;
    currency?: string;
  };

type AttemptRow = {
  paymentMethod?: string;
  gateway?: GatewayRefs | null;
  finalize?: { orderId?: unknown; orderNumber?: string } | null;
  snapshot?: (MoneyFields & { currency?: string }) | null;
};

const ORDER_FIELDS =
  "orderNumber paymentMethod paymentStatus currency total preorderOutstandingAmount storeCredit paypalOrderId razorpayOrderId paystackReference pesapalOrderTrackingId pesapalMerchantReference orangeMoneyOrderId orangeMoneyPayToken";

/** The order or attempt a reference names, or null when there is none for its method. */
export async function loadRedirectRecord(reference: AppPaymentReference): Promise<RedirectRecord | null> {
  if (reference.kind === "order") {
    const order = await Order.findById(reference.id).select(ORDER_FIELDS).lean<OrderRow | null>();
    if (!order) return null;
    const paid = isPaymentAlreadyRecorded(order.paymentStatus);
    // An order paid another way since ("Pay now" records the method that
    // finally paid) is still the payment this reference started.
    if (order.paymentMethod !== reference.method && !paid) return null;
    return {
      kind: "order",
      order: { id: String(order._id), number: order.orderNumber },
      paid,
      amountDue: amountDueNow(order),
      currency: String(order.currency || "").toUpperCase(),
      gateway: order,
    };
  }
  const attempt = await CheckoutAttempt.findById(reference.id)
    .select("paymentMethod gateway finalize snapshot")
    .lean<AttemptRow | null>();
  if (!attempt || attempt.paymentMethod !== reference.method) return null;
  const orderId = attempt.finalize?.orderId;
  const snapshot = attempt.snapshot ?? {};
  return {
    kind: "attempt",
    ...(orderId ? { order: { id: String(orderId), number: attempt.finalize?.orderNumber || "" } } : {}),
    paid: Boolean(orderId),
    amountDue: amountDueNow(snapshot),
    currency: String(snapshot.currency || "").toUpperCase(),
    gateway: attempt.gateway ?? {},
  };
}

/** The order's number, for a settlement that answered without one (an attempt promoted by an interrupted run). */
async function orderNumberOf(orderId: string): Promise<string> {
  const order = await Order.findById(orderId).select("orderNumber").lean<{ orderNumber?: string } | null>();
  return order?.orderNumber ?? "";
}

/** The settlement, as the app reads it: paid, refused-and-refunded, or not yet. */
async function settle(run: () => Promise<SettledCheckoutPayment>): Promise<RedirectVerification> {
  try {
    const result = await run();
    const orderNumber = result.orderNumber || (await orderNumberOf(result.orderId));
    return { status: "PAID", orderId: result.orderId, ...(orderNumber ? { orderNumber } : {}) };
  } catch (error) {
    // Another settlement of the same payment is mid-way: ask again.
    if (error instanceof ConflictError) return { status: "PENDING" };
    if (!(error instanceof ValidationError)) throw error;
    switch (error.message) {
      case SOLD_OUT_AFTER_CAPTURE:
        return { status: "CANCELLED", reason: "SOLD_OUT", refunded: true };
      case CANCELLED_BEFORE_CAPTURE:
        return { status: "CANCELLED", reason: "ORDER_CANCELLED", refunded: true };
      case CHECKOUT_CLOSED_BEFORE_PAYMENT:
        return { status: "CANCELLED", reason: "CHECKOUT_CLOSED", refunded: true };
    }
    // PayPal holds a capture under review: the webhook records it later.
    if (error.message.startsWith("PayPal payment not completed yet")) return { status: "PENDING" };
    // The gateway's answer did not match the order (amount, currency,
    // reference): nothing was recorded. The website answers the same refusal.
    console.error("A redirect payment could not be settled:", error);
    return { status: "FAILED", reason: "NOT_COMPLETED" };
  }
}

/** A gateway that could not be asked: the app asks again shortly. */
async function askGateway<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("A payment provider could not be asked about a payment:", error);
    throw new MobileApiError(503, "SERVICE_UNAVAILABLE", "The payment provider did not answer. Please try again shortly.", {
      headers: { "Retry-After": "5" },
    });
  }
}

const notYet = (gaveUp: boolean): RedirectVerification =>
  gaveUp ? { status: "CANCELLED", reason: "PAYER_CANCELLED" } : { status: "PENDING" };

const declined: RedirectVerification = { status: "FAILED", reason: "DECLINED" };
const lost: RedirectVerification = { status: "FAILED", reason: "NOT_COMPLETED" };

/**
 * What the gateway says of the payment a record is waiting for, settled when
 * the gateway reports it complete. `returnParams` is what the bridge passed on
 * (`status=cancel` when the payer gave up at the gateway; Razorpay's fields).
 */
export async function verifyRedirectPayment(input: {
  method: RedirectPaymentMethod;
  record: RedirectRecord;
  returnParams: Record<string, string>;
  settings: SettingsDocument;
  scope: CheckoutPaymentScope;
}): Promise<RedirectVerification> {
  const { record, returnParams, settings, scope } = input;
  const order = record.order ? { orderId: record.order.id, ...(record.order.number ? { orderNumber: record.order.number } : {}) } : {};
  if (record.paid) return { status: "PAID", ...order };
  const verification = await gatewayVerification();
  // Before the money, an order-first checkout already has its order.
  return verification.orderId ? verification : { ...verification, ...order };

  async function gatewayVerification(): Promise<RedirectVerification> {
    const gaveUp = returnParams.status === "cancel";
    const refs = record.gateway;
    switch (input.method) {
      case "paypal": {
        const creds = payPalCheckoutCredentials(settings);
        const paypalOrderId = refs.paypalOrderId;
        if (!paypalOrderId) return lost;
        const state = await askGateway(() => readPayPalCheckoutState({ paypalOrderId, creds }));
        if (state === "APPROVED" || state === "COMPLETED") {
          return settle(() => settlePayPalCheckout({ paypalOrderId, creds, settings, ...scope }));
        }
        if (state === "VOIDED" || state === "NOT_FOUND") return { status: "FAILED", reason: "EXPIRED" };
        return notYet(gaveUp);
      }
      case "razorpay": {
        const razorpayOrderId = refs.razorpayOrderId;
        if (!razorpayOrderId) return lost;
        const check = await askGateway(async () => {
          const paymentId = returnParams.razorpay_payment_id;
          const signature = returnParams.razorpay_signature;
          if (paymentId && signature && returnParams.razorpay_order_id === razorpayOrderId) {
            // Checkout's own fields, proven by their signature — the website's
            // verify. Fields that do not prove out are not trusted; Razorpay
            // is asked instead.
            try {
              return await checkRazorpayPayment({
                razorpayOrderId,
                razorpayPaymentId: paymentId,
                razorpaySignature: signature,
                settings,
                ...scope,
              });
            } catch (error) {
              if (!(error instanceof ValidationError) || error.message !== "Razorpay payment signature mismatch") {
                throw error;
              }
            }
          }
          return checkRazorpayOrderPayments({ razorpayOrderId, settings, ...scope });
        });
        if (check.state === "captured" || check.state === "authorized" || check.payment?.captured) {
          return settle(check.settle);
        }
        if (check.state === "failed" || returnParams.error) return declined;
        return notYet(gaveUp);
      }
      case "paystack": {
        assertPaystackEnabled(settings);
        const reference = refs.paystackReference;
        if (!reference) return lost;
        const check = await askGateway(() => checkPaystackPayment({ reference, settings, ...scope }));
        if (check.state === "success") return settle(check.settle);
        if (check.state === "failed" || check.state === "reversed") return declined;
        return notYet(gaveUp);
      }
      case "pesapal": {
        const orderTrackingId = refs.pesapalOrderTrackingId;
        if (!orderTrackingId) return lost;
        const check = await askGateway(() =>
          checkPesapalPayment({
            orderTrackingId,
            recordedMerchantReference: refs.pesapalMerchantReference,
            settings,
            ...scope,
          }),
        );
        if (check.state === "completed") return settle(check.settle);
        if (check.state === "reversed") return { status: "CANCELLED", reason: "REVERSED", refunded: true };
        if (check.state === "failed" || check.state === "invalid") return declined;
        return notYet(gaveUp);
      }
      case "orange_money": {
        const orangeMoneyOrderId = refs.orangeMoneyOrderId;
        const payToken = refs.orangeMoneyPayToken;
        // Written with the payment session; without it the session never completed.
        if (!orangeMoneyOrderId || !payToken) return lost;
        const check = await askGateway(() =>
          checkOrangeMoneyPayment({ orangeMoneyOrderId, payToken, amount: record.amountDue, settings, ...scope }),
        );
        if (check.state === "completed") return settle(check.settle);
        if (check.state === "failed" || check.state === "invalid") return declined;
        return notYet(gaveUp);
      }
    }
  }
}
