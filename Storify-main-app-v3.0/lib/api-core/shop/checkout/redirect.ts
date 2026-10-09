import {
  CHECKOUT_REASONS,
  RedirectPayment,
  RedirectPaymentRequest,
} from "@/contracts/mobile/shop/v1/checkout";
import { MobileApiError } from "@/lib/api-core/errors";
import { idempotencyScope } from "@/lib/api-core/pipeline";
import { defineRoute } from "@/lib/api-core/registry";
import { toMoney } from "@/lib/api-core/shop/money";
import { ApiError } from "@/lib/api/errors";
import { withRequestScope } from "@/lib/api/request-scope";
import { appBaseUrl } from "@/lib/app-url";
import { mintAppPaymentReference } from "@/lib/checkout/app-payment-reference";
import {
  appPaymentReturnLink,
  appRazorpayPayPageUrl,
} from "@/lib/checkout/app-payment-return";
import { CheckoutQuoteChangedError } from "@/lib/checkout/checkout-quote";
import { prepareCheckout } from "@/lib/checkout/prepare-checkout";
import { resolveCheckoutGatewayReadiness } from "@/lib/payments/checkout-gateways";
import { storeCurrencyCode } from "@/lib/payments/gateway-currencies";
import { isValidAppScheme } from "@/lib/settings/mobile-app";
import { getSettings } from "@/models/settings.model";
import {
  admitAppCart,
  appCheckoutIdentity,
  appUserAgent,
  assertDelivery,
  inShopperWords,
  toCheckoutError,
  toPlaceInput,
} from "./app-checkout";
import { pricesChanged } from "./quote";
import { startRedirectPayment } from "./redirect-payment";

/** The gateways' HTTP clients' own failures: the gateway refused, or did not answer. */
const GATEWAY_FAILURE = /^(PayPal|Razorpay|Paystack|Pesapal|Orange Money) /;

function unavailable(message: string): MobileApiError {
  return new MobileApiError(409, "CONFLICT", message, { reason: "PAYMENT_METHOD_UNAVAILABLE" });
}

/**
 * POST /checkout/redirect: start paying for the cart on a gateway's own page
 * (PayPal, Razorpay, Paystack, Pesapal, Orange Money), at the quote the
 * shopper accepted. The website's own start (lib/checkout/gateway-start/) —
 * the same order or checkout attempt, the same gateway session, the same
 * resume of a retry — with the gateway told to send the payer back to the
 * app's return bridge. Answers the page to open, the app link it comes back
 * on, and a reference to verify with (lib/checkout/app-payment-reference.ts).
 *
 * `Idempotency-Key` is required: a retry with the same key answers the same
 * payment from the idempotency store. A new key for the same cart is sent
 * back to the gateway page the first one made while it can still be paid —
 * the website's own resume, keyed on the cart and its contents.
 */
export const redirectPaymentRoute = defineRoute({
  id: "checkout.redirect.start",
  method: "POST",
  path: "/checkout/redirect",
  auth: "optional",
  cache: { kind: "private" },
  // The web checkout's own counter and preset. A replay counts too.
  rateLimit: { bucket: "payments:checkout", preset: "strict" },
  demo: "default",
  idempotency: "required",
  input: RedirectPaymentRequest,
  output: RedirectPayment,
  reasons: { values: CHECKOUT_REASONS },
  handler: ({ input, session, client, mobileApp, locale }) =>
    withRequestScope(async () => {
      const method = input.paymentMethod;
      assertDelivery(input);
      const body = toPlaceInput(input, method, locale);

      const settings = await getSettings();
      if (!settings.payment?.[method]?.enabled || !resolveCheckoutGatewayReadiness(settings)[method].ready) {
        throw unavailable("This payment method is not available.");
      }
      // Without the app's scheme the payer has no way back from the gateway.
      if (!isValidAppScheme(mobileApp.scheme)) {
        throw unavailable("This payment method is not available in the app yet.");
      }

      const identity = appCheckoutIdentity(session, client, appBaseUrl());
      try {
        const draft = await prepareCheckout(body, identity, {
          mode: "place",
          admitCart: admitAppCart(mobileApp),
          acceptedQuote: input.quoteHash,
        });
        const start = await startRedirectPayment(draft, method, {
          locale,
          request: { clientIp: identity.clientIp, userAgent: appUserAgent(client) },
        });
        const reference = mintAppPaymentReference({
          method,
          kind: start.record.kind,
          id: String(start.record.id),
          // The pipeline has refused a request without a scope.
          scope: idempotencyScope(session, client),
        });
        const url = start.gatewayUrl ?? (await appRazorpayPayPageUrl(locale, reference));
        const order =
          start.record.kind === "order"
            ? { orderId: String(start.record.id), orderNumber: start.record.orderNumber }
            : {};
        return {
          paymentMethod: method,
          url,
          returnUrl: appPaymentReturnLink(mobileApp.scheme, method),
          reference,
          amount: toMoney(draft.paymentDueNow, storeCurrencyCode(draft.settings)),
          ...order,
          resumed: start.resumed,
        };
      } catch (error) {
        if (error instanceof CheckoutQuoteChangedError) {
          throw await pricesChanged({
            input: { ...input, paymentMethod: method },
            session,
            client,
            mobileApp,
            locale,
          });
        }
        // The gateway refused the start, or did not answer. Nothing is left
        // behind: the order is written after the gateway's session (or retired
        // with it), and an attempt is closed with it.
        if (error instanceof Error && !(error instanceof ApiError) && GATEWAY_FAILURE.test(error.message)) {
          console.error(`The ${method} payment could not be started:`, error);
          throw new MobileApiError(
            409,
            "CONFLICT",
            "The payment could not be started. Nothing was charged; please try again.",
            { reason: "PAYMENT_FAILED" },
          );
        }
        throw await inShopperWords(toCheckoutError(error), locale);
      }
    }),
});
