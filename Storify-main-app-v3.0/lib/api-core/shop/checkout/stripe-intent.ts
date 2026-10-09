import {
  CHECKOUT_REASONS,
  StripeIntent,
  StripeIntentRequest,
} from "@/contracts/mobile/shop/v1/checkout";
import { MobileApiError } from "@/lib/api-core/errors";
import { idempotencyScope } from "@/lib/api-core/pipeline";
import { defineRoute } from "@/lib/api-core/registry";
import { toMoney } from "@/lib/api-core/shop/money";
import { withRequestScope } from "@/lib/api/request-scope";
import { appBaseUrl } from "@/lib/app-url";
import { CheckoutQuoteChangedError } from "@/lib/checkout/checkout-quote";
import {
  CardIntentFailure,
  CreateStripeIntentBodySchema,
  createStripeCardIntent,
} from "@/lib/checkout/stripe-card-intent";
import { paymentSheetExtras } from "@/lib/payments/stripe-wallet";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
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

function cardsUnavailable(): MobileApiError {
  return new MobileApiError(409, "CONFLICT", "Card payments are not available.", {
    reason: "PAYMENT_METHOD_UNAVAILABLE",
  });
}

/**
 * POST /checkout/stripe/intent: start paying for the cart by card, at the
 * quote the shopper accepted. Answers what Stripe's PaymentSheet is set up
 * with. The web's card intent (lib/checkout/stripe-card-intent.ts) — the same
 * pricing, holds, card-testing check and Stripe metadata, so Stripe's webhook
 * writes the order exactly as it does for the website — held to the quote's
 * hash instead of the cart's stored prices.
 *
 * `Idempotency-Key` is required: a retry with the same key answers with the
 * same PaymentIntent instead of a second one — from the idempotency store, or,
 * when the request that made it failed afterwards, from Stripe, which is
 * handed the key as its own.
 */
export const stripeIntentRoute = defineRoute({
  id: "checkout.stripe.intent",
  method: "POST",
  path: "/checkout/stripe/intent",
  auth: "optional",
  cache: { kind: "private" },
  // The web card intent's own counter and preset.
  rateLimit: { bucket: "payments:stripe-intent", preset: "strict" },
  demo: "default",
  idempotency: "required",
  input: StripeIntentRequest,
  output: StripeIntent,
  reasons: { values: CHECKOUT_REASONS },
  handler: ({ input, session, client, mobileApp, locale }) =>
    withRequestScope(async () => {
      assertDelivery(input);
      const body = toPlaceInput(input, "card", locale);
      const settings = await getSettings();
      const { publishableKey, secretKey } = resolveStripeCredentials(settings.payment?.stripe);
      if (!settings.payment?.stripe?.enabled || !publishableKey) throw cardsUnavailable();

      const identity = appCheckoutIdentity(session, client, appBaseUrl());
      try {
        const intent = await createStripeCardIntent(
          CreateStripeIntentBodySchema.parse({
            turnstileToken: body.turnstileToken,
            shippingAddress: body.shippingAddress,
            billingAddress: body.billingAddress,
            locale: body.locale,
            email: body.email,
            couponCode: body.couponCode,
            buyerAcceptsMarketing: body.buyerAcceptsMarketing,
            smsAcceptsMarketing: body.smsAcceptsMarketing,
            selectedShippingOptionId: body.selectedShippingOptionId,
            vendorShippingSelections: body.vendorShippingSelections,
            fulfillmentMethod: body.fulfillmentMethod,
            phone: body.phone,
            customerNote: body.customerNote,
            customFields: body.customFields,
            useStoreCredit: body.useStoreCredit,
          }),
          { ...identity, userAgent: appUserAgent(client) },
          {
            admitCart: admitAppCart(mobileApp),
            acceptedQuote: input.quoteHash,
            // The pipeline has refused a request without one.
            stripeIdempotencyKey: `mobile:${idempotencyScope(session, client)}:${client.idempotencyKey}`,
          },
        );
        // A card kept for later with nothing charged now is a pre-order's,
        // which the app's cart rules have already refused.
        if (intent.mode !== "payment") throw cardsUnavailable();
        // The wallets for everybody; saved cards only for a signed-in
        // shopper, whose own Customer the intent was made for.
        const extras = await paymentSheetExtras({
          secretKey,
          publishableKey,
          ...(session && intent.customerId ? { customerId: intent.customerId } : {}),
        });
        return {
          paymentIntentId: intent.paymentIntentId,
          clientSecret: intent.clientSecret,
          publishableKey,
          merchantDisplayName: settings.general?.storeName?.trim() || "Store",
          amount: toMoney(intent.amount, settings.general?.defaultCurrency || "USD"),
          ...extras,
        };
      } catch (error) {
        if (error instanceof CheckoutQuoteChangedError) {
          throw await pricesChanged({
            input: { ...input, paymentMethod: "card" },
            session,
            client,
            mobileApp,
            locale,
          });
        }
        if (error instanceof CardIntentFailure) {
          throw new MobileApiError(503, "SERVICE_UNAVAILABLE", "Card payments could not be started. Please try again.", {
            headers: { "Retry-After": "5" },
          });
        }
        throw await inShopperWords(toCheckoutError(error), locale);
      }
    }),
});
