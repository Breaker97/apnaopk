import {
  ORDER_PAY_REASONS,
  OrderPayVerification,
  OrderPayVerifyRequest,
} from "@/contracts/mobile/shop/v1/orders";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { ApiError, ValidationError } from "@/lib/api/errors";
import { withRequestScope } from "@/lib/api/request-scope";
import { CANCELLED_BEFORE_CAPTURE, isPaymentAlreadyRecorded } from "@/lib/payments/finalize-order";
import {
  ORDER_PAY_CHECKOUT_KIND,
  settleOrderPayFromPayPal,
  settleOrderPayIntent,
} from "@/lib/payments/order-pay";
import { payPalCheckoutCredentials, readPayPalCheckoutState } from "@/lib/payments/paypal-verify";
import { getStripeForSecretKey, isStripeSecretKeyConfigured } from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { findCustomerOrder } from "./detail";
import { payMethodUnavailable } from "./pay";
import { verifyOrderPushPayment } from "./pay-push";

function paymentNotFound(): MobileApiError {
  return new MobileApiError(404, "NOT_FOUND", "There is no such payment.");
}

/** A gateway that could not be asked: the app asks again shortly. */
function providerSilent(error: unknown): MobileApiError {
  console.error("A payment provider could not be asked about a Pay now payment:", error);
  return new MobileApiError(503, "SERVICE_UNAVAILABLE", "The payment provider did not answer. Please try again shortly.", {
    headers: { "Retry-After": "5" },
  });
}

/**
 * POST /orders/{id}/pay/verify: how a "Pay now" payment went, recorded on the
 * order when it went through — the same settlement the website's pay link and
 * the gateways' webhooks run (lib/payments/order-pay.ts), so whichever comes
 * first does the work and the other is told it was done.
 *
 * - `card`: the PaymentSheet's PaymentIntent, read back from Stripe; it must
 *   say, in metadata only this server writes, that it pays this order.
 * - `paypal`: the PayPal order this order's Pay now raised (the order's own
 *   reference, never one from the request), captured once approved.
 * - `mtn_momo`, `iotec`: the provider asked about the order's own prompt, as
 *   after a mobile-money checkout (`verifyOrderPushPayment`).
 */
export const orderPayVerifyRoute = defineRoute({
  id: "orders.pay.verify",
  method: "POST",
  path: "/orders/{id}/pay/verify",
  auth: "user",
  cache: { kind: "private" },
  // The website's pay confirmation's preset.
  rateLimit: { bucket: "orders:pay-verify", preset: "moderate" },
  demo: "default",
  input: OrderPayVerifyRequest,
  output: OrderPayVerification,
  reasons: { values: ORDER_PAY_REASONS },
  handler: ({ input, params, session, client }) =>
    withRequestScope(async () => {
      if (input.method === "mtn_momo" || input.method === "iotec") {
        const { status, reason } = await verifyOrderPushPayment({
          orderId: params.id,
          method: input.method,
          session,
          client,
        });
        return { status, ...(reason ? { reason } : {}) };
      }
      const order = await findCustomerOrder(params.id, session.user.id);
      const orderId = String(order._id);
      const settings = await getSettings();

      if (input.method === "card") {
        if (!input.paymentIntentId) {
          throw new MobileApiError(400, "VALIDATION_ERROR", "Send the card payment's paymentIntentId.", {
            errors: { paymentIntentId: ["Required for a card payment."] },
          });
        }
        const { secretKey } = resolveStripeCredentials(settings.payment?.stripe);
        if (!isStripeSecretKeyConfigured(secretKey)) throw payMethodUnavailable();
        let intent;
        try {
          intent = await getStripeForSecretKey(secretKey).paymentIntents.retrieve(input.paymentIntentId);
        } catch (error) {
          if ((error as { statusCode?: number })?.statusCode === 404) throw paymentNotFound();
          throw providerSilent(error);
        }
        // The intent must name this order in metadata this server wrote, or
        // any intent id a caller ever saw could be recorded here.
        const metadata = intent.metadata || {};
        if (metadata.kind !== ORDER_PAY_CHECKOUT_KIND || String(metadata.orderId || "") !== orderId) {
          throw paymentNotFound();
        }

        let result;
        try {
          result = await settleOrderPayIntent(intent, settings);
        } catch (error) {
          // The amount or currency did not match what the order owes: nothing
          // was recorded, and the admins have been told about the money.
          if (error instanceof ValidationError) return { status: "FAILED" as const, reason: "NOT_COMPLETED" };
          throw error;
        }
        if (result.settled) {
          if (!result.alreadyPaid) return { status: "PAID" as const };
          // Paid already: by this very payment (Stripe's webhook first), or by
          // another one meanwhile — then this charge has been sent back.
          const recorded = await Order.findById(orderId).select("paymentId").lean<{ paymentId?: string } | null>();
          return recorded?.paymentId === intent.id
            ? { status: "PAID" as const }
            : { status: "PAID" as const, reason: "DUPLICATE_REFUNDED" };
        }
        // Not charged: a card the bank refused, or none tried yet.
        if (intent.status === "requires_payment_method" || intent.status === "canceled") {
          return { status: "FAILED" as const, reason: intent.last_payment_error ? "DECLINED" : "NOT_COMPLETED" };
        }
        if (result.reason === "not_succeeded") return { status: "PENDING" as const };
        return { status: "FAILED" as const, reason: "NOT_COMPLETED" };
      }

      // PayPal: the approval this order's Pay now raised.
      const paypalOrderId = (order as unknown as { payLinkPaypalOrderId?: string }).payLinkPaypalOrderId;
      if (isPaymentAlreadyRecorded(order.paymentStatus)) return { status: "PAID" as const };
      if (!paypalOrderId) throw paymentNotFound();
      let creds;
      try {
        creds = payPalCheckoutCredentials(settings);
      } catch {
        throw payMethodUnavailable();
      }
      let state: string;
      try {
        state = await readPayPalCheckoutState({ paypalOrderId, creds });
      } catch (error) {
        throw providerSilent(error);
      }
      if (state === "VOIDED" || state === "NOT_FOUND") return { status: "FAILED" as const, reason: "EXPIRED" };
      if (state !== "APPROVED" && state !== "COMPLETED") {
        return input.returnParams?.status === "cancel"
          ? { status: "CANCELLED" as const, reason: "PAYER_CANCELLED" }
          : { status: "PENDING" as const };
      }
      try {
        await settleOrderPayFromPayPal({
          paypalOrderId,
          settings,
          sessionUserId: session.user.id,
          customerEmail: session.user.email || undefined,
        });
        return { status: "PAID" as const };
      } catch (error) {
        if (error instanceof ValidationError) {
          if (error.message === CANCELLED_BEFORE_CAPTURE) {
            return { status: "CANCELLED" as const, reason: "ORDER_CANCELLED" };
          }
          // PayPal holds the capture under review: its webhook records it later.
          if (error.message.startsWith("PayPal payment not completed yet")) return { status: "PENDING" as const };
          console.error("A Pay now PayPal payment could not be settled:", error);
          return { status: "FAILED" as const, reason: "NOT_COMPLETED" };
        }
        if (error instanceof ApiError) throw error;
        throw providerSilent(error);
      }
    }),
});
