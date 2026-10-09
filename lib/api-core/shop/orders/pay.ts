import {
  ORDER_PAY_REASONS,
  OrderPayRequest,
  OrderPayStart,
} from "@/contracts/mobile/shop/v1/orders";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { toMoney } from "@/lib/api-core/shop/money";
import { ApiError, ValidationError } from "@/lib/api/errors";
import { withRequestScope } from "@/lib/api/request-scope";
import {
  appPaymentReturnLink,
  appPaymentReturnUrl,
} from "@/lib/checkout/app-payment-return";
import {
  createOrderPayIntent,
  createOrderPayPayPalOrder,
  getOrderPayAmountDue,
  isOrderPayable,
  type PayableOrder,
} from "@/lib/payments/order-pay";
import { resolveStripeCustomerId } from "@/lib/payments/stripe-customer";
import { paymentSheetExtras } from "@/lib/payments/stripe-wallet";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { getSettings } from "@/models/settings.model";
import { findCustomerOrder } from "./detail";
import { payOrderByPush } from "./pay-push";
import { orderPayCurrency, orderPayMethodReady } from "./payment";

function orderNotPayable(): MobileApiError {
  return new MobileApiError(409, "CONFLICT", "This order has nothing to pay now.", { reason: "ORDER_NOT_PAYABLE" });
}

export function payMethodUnavailable(): MobileApiError {
  return new MobileApiError(409, "CONFLICT", "This way of paying is not available for this order.", {
    reason: "PAYMENT_METHOD_UNAVAILABLE",
  });
}

function payFailed(): MobileApiError {
  return new MobileApiError(409, "CONFLICT", "The payment could not be started. Nothing was charged; please try again.", {
    reason: "PAYMENT_FAILED",
  });
}

/**
 * A refusal of the pay-link functions (lib/payments/order-pay.ts) as the
 * contract words it. Their own wording stays in the logs.
 */
function toPayError(error: unknown): unknown {
  if (error instanceof ValidationError) {
    const message = error.message;
    if (message === "Order not found") return new MobileApiError(404, "NOT_FOUND", "Order not found.");
    if (message.startsWith("Card payment could not be started")) return payFailed();
    // Switched off or without keys meanwhile, or the order's currency is one
    // the gateway does not settle.
    return payMethodUnavailable();
  }
  // PayPal's own client failing: it refused, or did not answer.
  if (error instanceof Error && !(error instanceof ApiError) && /^PayPal /.test(error.message)) {
    console.error("A Pay now PayPal order could not be raised:", error);
    return payFailed();
  }
  return error;
}

/**
 * POST /orders/{id}/pay — "Pay now" for the shopper's own order whose payment
 * never arrived: everything it still owes, against the same order (no new
 * cart, no new prices). The website's pay link (lib/payments/order-pay.ts) on
 * the shopper's session, as the website's own pay route takes it:
 * - `card`: a PaymentIntent for PaymentSheet, one per order and amount
 *   (Stripe's own idempotency key), settled by POST /orders/{id}/pay/verify
 *   or Stripe's webhook, whichever is first;
 * - `paypal`: a PayPal order whose page the in-app browser opens, PayPal
 *   sending the payer back through the app's return bridge;
 * - `mtn_momo`, `iotec`: the phone of an order placed with that provider is
 *   prompted again (`payOrderByPush`, the website's Pay now resend).
 *
 * `Idempotency-Key` is required: a retry answers the same start.
 */
export const orderPayRoute = defineRoute({
  id: "orders.pay.start",
  method: "POST",
  path: "/orders/{id}/pay",
  auth: "user",
  cache: { kind: "private" },
  // The website's pay route's preset: a refused card must leave room for the next.
  rateLimit: { bucket: "orders:pay", preset: "moderate" },
  demo: "default",
  idempotency: "required",
  input: OrderPayRequest,
  output: OrderPayStart,
  reasons: { values: ORDER_PAY_REASONS },
  handler: ({ input, params, session, mobileApp, locale }) =>
    withRequestScope(async () => {
      if (input.method === "mtn_momo" || input.method === "iotec") {
        // Its own lookups and refusals (lib/api-core/shop/orders/pay-push.ts).
        const push = await payOrderByPush({
          orderId: params.id,
          method: input.method,
          payerPhone: input.payerPhone,
          session,
          locale,
        });
        return { flow: "push" as const, method: input.method, amount: push.amount, push };
      }
      const order = (await findCustomerOrder(params.id, session.user.id)) as unknown as PayableOrder;
      if (!isOrderPayable(order)) throw orderNotPayable();
      const settings = await getSettings();
      if (!orderPayMethodReady(input.method, order, settings, mobileApp.scheme)) throw payMethodUnavailable();
      const currency = orderPayCurrency(order, settings);
      const orderId = String(order._id);

      try {
        if (input.method === "card") {
          const { secretKey, publishableKey = "" } = resolveStripeCredentials(settings.payment?.stripe);
          // The shopper's own Customer, as checkout attaches it, so the sheet
          // offers their saved cards. Best-effort: without one the sheet is
          // the plain card form.
          const stripeCustomerId = await resolveStripeCustomerId({
            secretKey,
            userId: session.user.id,
            email: session.user.email || undefined,
            name: session.user.name || undefined,
          });
          const intent = await createOrderPayIntent({
            orderId,
            customerId: session.user.id,
            customerEmail: session.user.email || undefined,
            settings,
            ...(stripeCustomerId ? { stripeCustomerId } : {}),
          });
          if (intent.alreadyPaid) throw orderNotPayable();
          const amount = toMoney(intent.amount, intent.currency);
          const extras = await paymentSheetExtras({
            secretKey,
            publishableKey,
            ...(stripeCustomerId ? { customerId: stripeCustomerId } : {}),
          });
          return {
            flow: "card" as const,
            method: "card" as const,
            amount,
            card: {
              paymentIntentId: intent.paymentIntentId,
              clientSecret: intent.clientSecret,
              publishableKey,
              merchantDisplayName: settings.general?.storeName?.trim() || "Store",
              amount,
              ...extras,
            },
          };
        }

        const [returnUrl, cancelUrl] = await Promise.all([
          appPaymentReturnUrl(locale, "paypal", "return"),
          appPaymentReturnUrl(locale, "paypal", "cancel"),
        ]);
        const due = getOrderPayAmountDue(order);
        const paypal = await createOrderPayPayPalOrder({
          orderId,
          customerId: session.user.id,
          returnUrl,
          cancelUrl,
          settings,
        });
        if (paypal.alreadyPaid) throw orderNotPayable();
        return {
          flow: "redirect" as const,
          method: "paypal" as const,
          amount: toMoney(due, currency),
          redirect: {
            url: paypal.approvalUrl,
            returnUrl: appPaymentReturnLink(mobileApp.scheme, "paypal"),
          },
        };
      } catch (error) {
        if (error instanceof MobileApiError) throw error;
        throw toPayError(error);
      }
    }),
});
