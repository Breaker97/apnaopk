import {
  CHECKOUT_REASONS,
  CheckoutQuote,
  CheckoutQuoteRequest,
} from "@/contracts/mobile/shop/v1/checkout";
import { MobileApiError } from "@/lib/api-core/errors";
import type { ClientInfo } from "@/lib/api-core/client-info";
import type { MobileSession } from "@/lib/api-core/ports";
import { defineRoute } from "@/lib/api-core/registry";
import { withRequestScope } from "@/lib/api/request-scope";
import { appBaseUrl } from "@/lib/app-url";
import { getCouponCopy } from "@/lib/catalog/coupon-copy";
import { CouponRefusedError } from "@/lib/catalog/coupons";
import { prepareCheckout } from "@/lib/checkout/prepare-checkout";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import type { MobileShopAppSettings } from "@/lib/settings/mobile-app";
import {
  admitAppCart,
  appCheckoutIdentity,
  assertDelivery,
  toCheckoutError,
  toQuoteInput,
} from "./app-checkout";
import { toCheckoutQuote } from "./quote-dto";

type QuoteRequestContext = {
  input: CheckoutQuoteRequest;
  session: MobileSession | null;
  client: ClientInfo;
  mobileApp: MobileShopAppSettings;
  locale: string;
};

/**
 * The order as it would be placed now — the web checkout's own pricing, run
 * without writing anything (`prepareCheckout`, mode "quote").
 */
async function quoteCheckout(ctx: QuoteRequestContext): Promise<CheckoutQuote> {
  assertDelivery(ctx.input);
  const origin = appBaseUrl();
  const { input, schemaErrors } = toQuoteInput(ctx.input, ctx.locale);
  try {
    const [priced, routing] = await Promise.all([
      prepareCheckout(input, appCheckoutIdentity(ctx.session, ctx.client, origin), {
        mode: "quote",
        admitCart: admitAppCart(ctx.mobileApp),
      }),
      getLocaleRouting(),
    ]);
    const couponError = priced.couponError;
    return toCheckoutQuote(priced, {
      ...(couponError instanceof CouponRefusedError
        ? { couponRefusal: { error: couponError, copy: await getCouponCopy(ctx.locale) } }
        : {}),
      locale: ctx.locale,
      storeDefault: routing.storeDefault,
      origin,
      schemaErrors,
      couponCode: input.couponCode,
      appScheme: ctx.mobileApp.scheme,
    });
  } catch (error) {
    throw toCheckoutError(error);
  }
}

/**
 * The refusal of an order that is no longer what its quote said: 409
 * PRICES_CHANGED with the quote as it stands now. When even that cannot be
 * made (the cart was emptied meanwhile, say), that refusal instead.
 */
export async function pricesChanged(ctx: QuoteRequestContext): Promise<MobileApiError> {
  try {
    const quote = await quoteCheckout(ctx);
    return new MobileApiError(
      409,
      "CONFLICT",
      "Your order total has changed. Review the new total, then place your order again.",
      { reason: "PRICES_CHANGED", details: { quote } },
    );
  } catch (error) {
    if (error instanceof MobileApiError) return error;
    throw error;
  }
}

/**
 * POST /checkout/quote: the order as it would be placed now — the cart at
 * live prices, delivery, totals, the payment methods that can take it, the
 * form the store asks for and what of it is missing — and, once the money is
 * settled, the hash to place it with. Writes nothing.
 */
export const checkoutQuoteRoute = defineRoute({
  id: "checkout.quote",
  method: "POST",
  path: "/checkout/quote",
  auth: "optional",
  cache: { kind: "private" },
  // Asked again on every change of the form: the general preset, not the
  // checkout's own strict one, which counts placed orders.
  rateLimit: { bucket: "checkout:quote", preset: "lenient" },
  demo: "default",
  input: CheckoutQuoteRequest,
  output: CheckoutQuote,
  reasons: { values: CHECKOUT_REASONS },
  handler: ({ input, session, client, mobileApp, locale }) =>
    withRequestScope(() => quoteCheckout({ input, session, client, mobileApp, locale })),
});
