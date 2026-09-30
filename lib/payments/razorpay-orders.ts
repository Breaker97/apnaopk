import { Order } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import {
  captureAuthorizedRazorpayPayment,
  fromRazorpayAmountSubunits,
  getRazorpayCredentials,
  isRazorpayConfigured,
  refundRazorpayPayment,
  toRazorpayAmountSubunits,
  type RazorpayCredentials,
  type RazorpayPayment,
} from "@/lib/payments/razorpay";
import { gatewayFeeUpdate, razorpayFee } from "@/lib/payments/gateway-fee";
import {
  amountDueNow,
  type SettingsDocument,
} from "@/lib/payments/finalize-order";
import {
  finalizeCapturedAttempt,
  findAttemptByGatewayRef,
} from "@/lib/payments/finalize-attempt";
import { notifyAdminsPaymentAnomaly } from "@/lib/notifications/notifications";

type FinalizeRazorpayOrderParams = {
  razorpayOrderId: string;
  payment: RazorpayPayment;
  /**
   * Lets the verifier capture a payment Razorpay has only authorized. The
   * payer's verify call passes them; the webhook does not, because the events
   * it settles on (`payment.captured`, `order.paid`) are captured already.
   */
  creds?: RazorpayCredentials;
  settings: SettingsDocument;
  sessionUserId?: string;
  cartSessionId?: string;
  customerEmail?: string;
};

/** Settles the order behind a Razorpay payment, capturing it if need be. */
export function finalizeRazorpayOrder(params: FinalizeRazorpayOrderParams) {
  return finalizeCapturedAttempt({
    // Attempt first, then the pending order a pre-attempt checkout wrote. Both
    // are asked whatever the rollout flag says — see `finalize-attempt.ts`.
    findAttempt: (scope) =>
      findAttemptByGatewayRef("razorpayOrderId", params.razorpayOrderId, scope),
    orderPrefix: params.settings.orders?.prefix,
    provider: {
      paymentMethod: "razorpay",
      label: "Razorpay",
      recoveryGateway: "razorpay",
      // An authorised-only payment is captured by `verify`. On a cancelled
      // order it is left to lapse instead: capturing it only to refund it
      // cost the Razorpay fee and put both entries on the shopper's statement.
      capturesOnVerify:
        params.payment.status !== "captured" && params.payment.captured !== true,
    },
    findOrder: (scope) =>
      Order.findOne({ ...scope, razorpayOrderId: params.razorpayOrderId }),
    notFoundMessage: "Order not found for Razorpay payment",
    onAlreadyPaid: (order) =>
      returnSecondRazorpayPayment({
        order,
        payment: params.payment,
        settings: params.settings,
      }),
    verify: async (order) => {
      if (params.payment.order_id !== params.razorpayOrderId) {
        throw new ValidationError("Razorpay order mismatch");
      }

      // The currency the order was placed in. Today's store default drifts:
      // a store that switched currency left money it had taken unrecorded.
      const expectedCurrency = (
        order.currency ||
        params.settings.general?.defaultCurrency ||
        "USD"
      ).toUpperCase();
      const paymentCurrency = String(
        params.payment.currency || "",
      ).toUpperCase();
      if (paymentCurrency !== expectedCurrency) {
        throw new ValidationError("Razorpay currency mismatch");
      }

      const amountDue = amountDueNow(order);
      const expectedAmount = toRazorpayAmountSubunits(
        amountDue,
        expectedCurrency,
      );
      if (Number(params.payment.amount) !== expectedAmount) {
        throw new ValidationError("Razorpay amount mismatch");
      }

      // Captured here rather than by the route: `verify` runs only for an
      // order that is still unpaid and not cancelled, so an authorized payment
      // is never captured for an order that can no longer be settled.
      const payment = params.creds
        ? await captureAuthorizedRazorpayPayment({
            creds: params.creds,
            payment: params.payment,
            amount: amountDue,
            currency: expectedCurrency,
          })
        : params.payment;

      if (payment.status !== "captured" && payment.captured !== true) {
        throw new ValidationError(
          `Razorpay payment not captured: ${payment.status}`,
        );
      }

      return {
        paymentId: payment.id,
        paymentUpdate: {
          razorpayPaymentId: payment.id,
          // `fee` appears once the payment is captured; an authorized-only
          // payment reports none, and gatewayFeeUpdate writes nothing for it.
          ...gatewayFeeUpdate(razorpayFee(payment)),
        },
        customerEmail: payment.email || undefined,
      };
    },
    settings: params.settings,
    sessionUserId: params.sessionUserId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
  });
}

/**
 * A second payment captured against an order that is already paid.
 *
 * Checkout retries reuse one Razorpay order, and Razorpay will capture a
 * second payment on it (a late authorisation with auto-capture on). The
 * replay guard answered `alreadyPaid` and the shopper stayed charged twice
 * with nobody told. The stray payment is sent back in full — it was never
 * recorded on the order, so nothing there changes — and an admin is told
 * either way.
 */
async function returnSecondRazorpayPayment(params: {
  order: { _id: unknown; orderNumber?: string; razorpayPaymentId?: string | null };
  payment: RazorpayPayment;
  settings: SettingsDocument;
}): Promise<void> {
  const { order, payment, settings } = params;
  const stored = String(order.razorpayPaymentId || "");
  const incoming = String(payment?.id || "");
  if (!stored || !incoming || stored === incoming) return;
  // An authorisation that was never captured lapses on its own.
  if (payment.status !== "captured" && payment.captured !== true) return;

  const currency = String(payment.currency || "").toUpperCase();
  const amount = fromRazorpayAmountSubunits(Number(payment.amount || 0), currency);
  let refunded = false;
  try {
    const razorpay = settings.payment?.razorpay;
    if (
      razorpay?.enabled &&
      isRazorpayConfigured(razorpay.keyId, razorpay.keySecret)
    ) {
      await refundRazorpayPayment({
        creds: getRazorpayCredentials({
          keyId: razorpay.keyId,
          keySecret: razorpay.keySecret,
        }),
        paymentId: incoming,
        notes: { reason: `Duplicate payment on order ${order.orderNumber || ""}` },
      });
      refunded = true;
    }
  } catch (err) {
    console.error("Failed to refund a duplicate Razorpay payment:", err);
  }

  await notifyAdminsPaymentAnomaly({
    title: refunded
      ? "Duplicate Razorpay payment refunded"
      : "Duplicate Razorpay payment needs a refund",
    message: refunded
      ? `Order ${order.orderNumber} was already paid (${stored}). A second payment ${incoming} of ${amount} ${currency} was captured and has been refunded.`
      : `Order ${order.orderNumber} was already paid (${stored}). A second payment ${incoming} of ${amount} ${currency} was captured and could not be refunded automatically. Refund it from the Razorpay dashboard.`,
    dedupeKey: `razorpay-duplicate:${incoming}`,
    link: `/admin/orders/${String(order._id)}`,
  });
}
