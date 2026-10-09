import type * as z from "zod";
import type {
  CheckoutQuoteRequest,
  CheckoutReason,
  PlaceOrderRequest,
} from "@/contracts/mobile/shop/v1/checkout";
import type { ClientInfo } from "@/lib/api-core/client-info";
import { MobileApiError } from "@/lib/api-core/errors";
import type { MobileSession } from "@/lib/api-core/ports";
import { cartLineKeyOf } from "@/lib/api-core/shop/cart/app-cart";
import { getCouponCopy } from "@/lib/catalog/coupon-copy";
import { toMoney } from "@/lib/api-core/shop/money";
import { ApiError, ValidationError } from "@/lib/api/errors";
import { CouponRefusedError } from "@/lib/catalog/coupons";
import { formatCurrency } from "@/lib/intl/money";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import { resolveItemShipping } from "@/lib/catalog/product-shipping";
import { CARD_TESTING_BLOCKED_MESSAGE } from "@/lib/checkout/card-testing-guard";
import type {
  AdmissibleCartItem,
  CheckoutIdentity,
  CheckoutInput,
} from "@/lib/checkout/prepare-checkout";
import { PURCHASE_TYPE } from "@/lib/orders/preorders";
import type { MobileShopAppSettings } from "@/lib/settings/mobile-app";
import { SHIPPING_UNAVAILABLE_MESSAGE } from "@/lib/shipping/shipping";
import { CheckoutSchema } from "@/lib/validations";

/**
 * The shopper app's side of checkout: whose cart, what the app may not check
 * out, the request as the web checkout reads it, and the web checkout's
 * refusals as the contract words them. The checkout itself is the web's
 * (lib/checkout/prepare-checkout.ts, place-cod-order.ts,
 * stripe-card-intent.ts), run on the same rules.
 */

/** The account's cart when signed in, else the guest's (`X-Cart-Token`). */
export function appCheckoutIdentity(
  session: MobileSession | null,
  client: ClientInfo,
  origin: string,
): CheckoutIdentity {
  return {
    user: session
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          phone: session.user.phone ?? null,
        }
      : null,
    cartSessionId: client.cartToken,
    // As the web reads an address it cannot resolve (getClientIP).
    clientIp: client.ip ?? "unknown",
    origin,
  };
}

/** What a checkout attempt's record says asked for it, in place of a browser's. */
export function appUserAgent(client: ClientInfo): string {
  const version = client.appVersion ? `/${client.appVersion}` : "";
  return client.platform ? `storify-shop-app${version} (${client.platform})` : `storify-shop-app${version}`;
}

function conflict(reason: CheckoutReason, message: string, details?: Record<string, unknown>) {
  return new MobileApiError(409, "CONFLICT", message, { reason, ...(details ? { details } : {}) });
}

/**
 * What the app may not check out, on top of the store's own rules:
 * pre-orders (v1), and lines that ship nothing unless the store sells
 * digital goods in its app (Settings → Mobile app). The same rule the app's
 * cart applies (`admitInApp`, lib/api-core/shop/cart/app-cart.ts), here for
 * every line at once, so the app can mark each one.
 */
export function admitAppCart(
  shop: Pick<MobileShopAppSettings, "allowDigitalPurchases">,
): (items: AdmissibleCartItem[]) => void {
  return (items) => {
    const keyOf = (item: AdmissibleCartItem) =>
      cartLineKeyOf(
        String(item.productId._id),
        item.variantId ? String(item.variantId) : undefined,
      );
    const preorders = items.filter((item) => item.purchaseType === PURCHASE_TYPE.PREORDER);
    if (preorders.length > 0) {
      throw conflict("PRE_ORDER", "Pre-orders cannot be placed in the app yet.", {
        lines: preorders.map(keyOf),
      });
    }
    if (shop.allowDigitalPurchases) return;
    const unshipped = items.filter((item) => {
      const variant = item.variantId
        ? item.productId.variants?.find((candidate) => String(candidate._id) === String(item.variantId))
        : undefined;
      return !resolveItemShipping({
        productShipping: item.productId.shipping,
        variantShipping: { requiresShipping: variant?.requiresShipping },
      }).requiresShipping;
    });
    if (unshipped.length > 0) {
      throw conflict("NOT_PURCHASABLE_IN_APP", "These products cannot be bought in the app.", {
        lines: unshipped.map(keyOf),
      });
    }
  };
}

/** Collection from a branch is the website's only, in v1 of the app. */
export function assertDelivery(body: Pick<CheckoutQuoteRequest, "fulfillmentMethod">): void {
  if (body.fulfillmentMethod === "pickup") {
    throw conflict("PICKUP_NOT_SUPPORTED", "Collecting from a store is not available in the app yet.");
  }
}

type AppAddress = NonNullable<CheckoutQuoteRequest["shippingAddress"]>;

/** The name an address goes by: the one sent, else first and last name. */
function fullNameOf(address: AppAddress): string {
  return (
    address.fullName?.trim() ||
    [address.firstName, address.lastName].map((part) => part?.trim()).filter(Boolean).join(" ")
  );
}

const blankToUndefined = (value: string | undefined) => (value?.trim() ? value : undefined);

/**
 * The request as the web checkout's body (`CheckoutSchema`), before it is
 * parsed. The app never uses store credit in v1, so it is never applied.
 */
function webBodyOf(
  body: CheckoutQuoteRequest & { turnstileToken?: string },
  paymentMethod: CheckoutQuoteRequest["paymentMethod"],
  locale: string,
) {
  const address = (value: AppAddress | undefined) =>
    value
      ? {
          ...value,
          fullName: fullNameOf(value),
          street: value.street ?? "",
          city: value.city ?? "",
          country: value.country ?? "",
        }
      : undefined;
  return {
    shippingAddress: address(body.shippingAddress),
    billingAddress: address(body.billingAddress),
    paymentMethod,
    email: blankToUndefined(body.email),
    phone: blankToUndefined(body.phone),
    couponCode: blankToUndefined(body.couponCode),
    selectedShippingOptionId: body.selectedShippingOptionId,
    vendorShippingSelections: body.vendorShippingSelections,
    fulfillmentMethod: "delivery" as const,
    customerNote: body.customerNote,
    customFields: body.customFields,
    buyerAcceptsMarketing: body.buyerAcceptsMarketing,
    smsAcceptsMarketing: body.smsAcceptsMarketing,
    turnstileToken: body.turnstileToken,
    // `CheckoutSchema` takes a two-letter language for the emails it sends.
    locale: locale.length === 2 ? locale : undefined,
    useStoreCredit: false,
  };
}

/** A zod failure as field errors keyed like the request ("shippingAddress.city"). */
function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_error";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

/**
 * The body of POST /checkout/orders, /checkout/stripe/intent or
 * /checkout/redirect or /checkout/push, read exactly as the web checkout reads its own
 * (`CheckoutSchema`): the same address rules, the same limits. A refusal
 * names the field.
 */
export function toPlaceInput(
  body: PlaceOrderRequest,
  paymentMethod: NonNullable<CheckoutQuoteRequest["paymentMethod"]>,
  locale: string,
): CheckoutInput & z.infer<typeof CheckoutSchema> {
  const parsed = CheckoutSchema.safeParse(webBodyOf(body, paymentMethod, locale));
  if (!parsed.success) {
    const errors = fieldErrorsOf(parsed.error);
    throw new MobileApiError(400, "VALIDATION_ERROR", "Please check the highlighted fields.", { errors });
  }
  return parsed.data;
}

/**
 * The body of POST /checkout/quote: taken as it is, half-filled addresses
 * included (the quote prices what it can), next to what the web's body rules
 * would refuse in it so far, for `fieldErrors`.
 */
export function toQuoteInput(
  body: CheckoutQuoteRequest,
  locale: string,
): { input: CheckoutInput; schemaErrors: Record<string, string[]> } {
  const raw = webBodyOf(body, body.paymentMethod, locale);
  const checked = CheckoutSchema.safeParse({ ...raw, paymentMethod: raw.paymentMethod ?? "cod" });
  const schemaErrors = checked.success ? {} : fieldErrorsOf(checked.error);
  // What the web reads them as when it can parse them, and the raw value of a
  // field it cannot, so one bad field does not cost the quote the rest.
  const input = (checked.success ? { ...checked.data, paymentMethod: body.paymentMethod } : raw) as CheckoutInput;
  if (!checked.success) {
    // Invalid values are left out of the pricing instead of priced as typed.
    for (const key of Object.keys(schemaErrors)) {
      const [field] = key.split(".");
      if (field === "couponCode" || field === "email" || field === "phone") {
        (input as Record<string, unknown>)[field] = undefined;
      }
    }
  }
  return { input, schemaErrors };
}

/**
 * How long a paused shopper is told to wait, in seconds: the pause's own
 * length (lib/checkout/card-testing-guard.ts), which its message calls
 * "about half an hour".
 */
const PAYMENTS_PAUSE_SECONDS = 30 * 60;

const COD_REFUSALS = [
  "Cash on Delivery is disabled",
  "Cash on Delivery is not available",
  "Minimum order amount for Cash on Delivery",
  "Maximum order amount for Cash on Delivery",
];

/**
 * The redirect gateways' own refusals of a method they cannot take this order
 * with (lib/checkout/gateway-start/): switched off, without keys, or — Orange
 * Money — nothing to collect, or a fraction of a currency without one.
 */
const GATEWAY_UNAVAILABLE = [
  /^(PayPal|Razorpay|Paystack|Pesapal|Orange Money) is (disabled|not configured)/,
  /^This order has nothing left to pay/,
  /has no minor unit, so .* cannot be charged/,
];

/** The redirect gateways' refusals of a start they could not complete: nothing is left behind. */
const GATEWAY_REFUSED = [
  "Pesapal returned an invalid order response",
  "Orange Money payment session could not be stored. Please try again.",
];

/**
 * A code checkout refused: 400 COUPON_INVALID on `couponCode`, with the
 * coupon's own reason in `details` (`CouponInvalidDetails`). Its sentence is
 * the website's English until `inShopperWords` words it in the path's locale.
 */
class CouponInvalidError extends MobileApiError {
  constructor(readonly refusal: CouponRefusedError) {
    const message = refusal.errors.code?.[0] ?? refusal.message;
    super(400, "VALIDATION_ERROR", message, {
      reason: "COUPON_INVALID",
      errors: { couponCode: [message] },
      details: { couponReason: refusal.refusal, couponMessage: message },
    });
  }
}

/**
 * A mapped checkout refusal, with what the store words for the shopper put in
 * the path's locale: today a refused coupon's reason, and what the cart is
 * short of in the store's currency. Anything else is passed on as it is.
 */
export async function inShopperWords(error: unknown, locale: string): Promise<unknown> {
  if (!(error instanceof CouponInvalidError)) return error;
  const { refusal } = error;
  const [copy, currency] = await Promise.all([getCouponCopy(locale), getStoreCurrency()]);
  const shortBy = refusal.facts.shortBy && refusal.facts.shortBy > 0 ? refusal.facts.shortBy : undefined;
  const couponMessage = copy.refusal(refusal.refusal, {
    ...(shortBy ? { shortBy: formatCurrency(shortBy, currency.code, currency.locale) } : {}),
    ...(refusal.facts.startsAt ? { startsAt: refusal.facts.startsAt } : {}),
  });
  return new MobileApiError(400, "VALIDATION_ERROR", error.message, {
    reason: "COUPON_INVALID",
    errors: error.options.errors,
    details: {
      couponReason: refusal.refusal,
      couponMessage,
      ...(shortBy ? { shortBy: toMoney(shortBy, currency) } : {}),
    },
  });
}

/**
 * A refusal of the web checkout as the contract words it (`CHECKOUT_REASONS`).
 * Field errors stay field errors, keyed like the request; what is about the
 * cart, the stock, the payment method or the store becomes a reason. Anything
 * else is passed on as it is.
 */
export function toCheckoutError(error: unknown): unknown {
  if (!(error instanceof ApiError) || error instanceof MobileApiError) return error;
  if (!(error instanceof ValidationError)) return error;
  if (error instanceof CouponRefusedError) return new CouponInvalidError(error);

  const errors = error.errors;
  const first = (key: string) => errors[key]?.[0];
  const only = Object.keys(errors).length === 1;

  // The store sells to signed-in shoppers only: whatever else the form lacks,
  // signing in comes first (lib/checkout/checkout-form-policy.ts).
  if (first("account")) {
    return new MobileApiError(401, "AUTHENTICATION_ERROR", "Please sign in to place your order.", {
      reason: "SIGN_IN_REQUIRED",
    });
  }
  if (first("cart") === "Cart is empty") return conflict("CART_EMPTY", "Your cart is empty.");
  if (first("cart")) return conflict("NOT_AVAILABLE", first("cart")!);
  if (first("stock")) return conflict("OUT_OF_STOCK", first("stock")!);
  if (first("sku")) return conflict("NOT_AVAILABLE", first("sku")!);
  if (first("turnstile")) {
    return new MobileApiError(400, "VALIDATION_ERROR", first("turnstile")!, {
      reason: "CAPTCHA_REQUIRED",
      errors: { turnstileToken: errors.turnstile },
    });
  }
  if (first("payment") === CARD_TESTING_BLOCKED_MESSAGE) {
    return new MobileApiError(429, "RATE_LIMIT_EXCEEDED", CARD_TESTING_BLOCKED_MESSAGE, {
      reason: "PAYMENTS_PAUSED",
      details: { retryAfter: PAYMENTS_PAUSE_SECONDS },
      headers: { "Retry-After": String(PAYMENTS_PAUSE_SECONDS) },
    });
  }
  if (first("code")) {
    return new MobileApiError(400, "VALIDATION_ERROR", first("code")!, {
      reason: "COUPON_INVALID",
      errors: { couponCode: errors.code },
    });
  }
  if (first("paymentMethod")) {
    return conflict("PAYMENT_METHOD_UNAVAILABLE", first("paymentMethod")!);
  }
  const message = first("_error");
  if (only && message) {
    if (message === SHIPPING_UNAVAILABLE_MESSAGE) {
      return conflict("SHIPPING_UNAVAILABLE", message);
    }
    if (
      COD_REFUSALS.some((prefix) => message.startsWith(prefix)) ||
      GATEWAY_UNAVAILABLE.some((pattern) => pattern.test(message)) ||
      message.startsWith("Stripe is ") ||
      message.startsWith("This payment method can't take payments")
    ) {
      return conflict("PAYMENT_METHOD_UNAVAILABLE", message);
    }
    if (GATEWAY_REFUSED.includes(message)) {
      return conflict("PAYMENT_FAILED", "The payment could not be started. Nothing was charged; please try again.");
    }
    if (message === "This order is already being placed. Please wait a moment.") {
      return new MobileApiError(409, "REQUEST_IN_PROGRESS", message, {
        headers: { "Retry-After": "2" },
      });
    }
    return new MobileApiError(400, "VALIDATION_ERROR", message);
  }
  return new MobileApiError(400, "VALIDATION_ERROR", error.message, { errors });
}
