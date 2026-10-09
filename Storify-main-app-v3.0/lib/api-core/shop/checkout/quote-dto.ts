import type {
  CheckoutCoupon,
  CheckoutForm,
  CheckoutPaymentMethod,
  CheckoutQuote,
  CheckoutQuoteLine,
  CheckoutShipping,
  CheckoutShippingOption,
} from "@/contracts/mobile/shop/v1/checkout";
import { cartLineKeyOf } from "@/lib/api-core/shop/cart/app-cart";
import type { CouponCopy } from "@/lib/catalog/coupon-words";
import { imageSet } from "@/lib/api-core/shop/images";
import { toMoney } from "@/lib/api-core/shop/money";
import {
  CONFIGURABLE_ADDRESS_FIELDS,
  type CheckoutSettings,
} from "@/lib/checkout/checkout-config";
import { checkoutFiguresOf, checkoutQuoteHash } from "@/lib/checkout/checkout-quote";
import { codLimitBreach } from "@/lib/checkout/cod-limits";
import { marketingBoxDefaultChecked } from "@/lib/checkout/marketing-preselect";
import type { PricedCheckout } from "@/lib/checkout/prepare-checkout";
import { turnstileSiteKey } from "@/lib/checkout/turnstile";
import { buildLocalePath, type LocaleRouting } from "@/lib/i18n/locale-prefix";
import type { CouponRefusedError } from "@/lib/catalog/coupons";
import { resolveCurrency, type Currency } from "@/lib/intl/currencies";
import { formatCurrency } from "@/lib/intl/money";
import {
  resolveCheckoutGatewayReadiness,
  type CheckoutGatewayReadiness,
} from "@/lib/payments/checkout-gateways";
import { IOTEC_MIN_AMOUNT } from "@/lib/payments/iotec";
import { isValidAppScheme } from "@/lib/settings/mobile-app";
import type { ShippingRateOption } from "@/lib/shipping/shipping";

/**
 * A priced checkout (`prepareCheckout(…, { mode: "quote" })`) as the contract
 * sends it (`CheckoutQuote`). Every figure is the checkout's own; nothing is
 * added up here.
 */

interface QuoteContext {
  /** The path's locale, for the policy links. */
  locale: string;
  /** The store's default locale: its links carry no prefix. */
  storeDefault: LocaleRouting["storeDefault"];
  /** The store's origin, for the captcha page and the policy links. */
  origin: string;
  /** What the web's body rules would refuse in the request so far. */
  schemaErrors: Record<string, string[]>;
  /** The code the shopper typed, shown back when it does not apply. */
  couponCode?: string;
  /** Why it does not apply, and the store's words for it in the path's locale. */
  couponRefusal?: { error: CouponRefusedError; copy: CouponCopy };
  /** The store's app scheme: a gateway's page has no way back to the app without it. */
  appScheme: string;
}

/** A refused code's reason, its sentence and what the cart is short of (`CheckoutCoupon`). */
function couponRefusalOf(
  refusal: QuoteContext["couponRefusal"],
  currency: Pick<Currency, "code" | "locale">,
): Pick<CheckoutCoupon, "reason" | "reasonMessage" | "shortBy"> {
  if (!refusal) return {};
  const { error, copy } = refusal;
  const shortBy = error.facts.shortBy && error.facts.shortBy > 0 ? error.facts.shortBy : undefined;
  return {
    reason: error.refusal,
    reasonMessage: copy.refusal(error.refusal, {
      ...(shortBy ? { shortBy: formatCurrency(shortBy, currency.code, currency.locale) } : {}),
      ...(error.facts.startsAt ? { startsAt: error.facts.startsAt } : {}),
    }),
    ...(shortBy ? { shortBy: toMoney(shortBy, currency) } : {}),
  };
}

const idOf = (value: unknown) =>
  value && typeof value === "object" && "_id" in value
    ? String((value as { _id: unknown })._id)
    : String(value ?? "");

function shippingOption(
  option: ShippingRateOption,
  money: (amount: number) => CheckoutQuoteLine["unitPrice"],
): CheckoutShippingOption {
  return {
    id: option.id,
    name: option.name,
    price: money(option.cost),
    ...(option.deliveryDays ? { minDays: option.deliveryDays.min, maxDays: option.deliveryDays.max } : {}),
  };
}

function shippingOf(
  priced: PricedCheckout,
  money: (amount: number) => CheckoutQuoteLine["unitPrice"],
): CheckoutShipping {
  const empty = { options: [], sellers: [] };
  if (!priced.hasShippableItems) return { status: "NOT_REQUIRED", ...empty };
  if (priced.awaitingAddress || !priced.shippingResolution) {
    return { status: "NEEDS_ADDRESS", ...empty };
  }
  if (priced.shippingUnavailable) return { status: "UNAVAILABLE", ...empty };
  const resolution = priced.shippingResolution;
  if (resolution.mode === "vendor") {
    return {
      status: "READY",
      options: [],
      sellers: resolution.vendorGroups.map((group) => ({
        vendorId: group.vendorId,
        ...(group.vendorName ? { name: group.vendorName } : {}),
        options: group.options.map((option) => shippingOption(option, money)),
        ...(group.selectedOptionId ? { selectedOptionId: group.selectedOptionId } : {}),
        price: money(group.cost),
      })),
    };
  }
  const selected = resolution.selectedShippingMethod?.optionId;
  return {
    status: "READY",
    options: resolution.singleOptions.map((option) => shippingOption(option, money)),
    ...(selected ? { selectedOptionId: selected } : {}),
    sellers: [],
  };
}

type MethodAnswer = Omit<CheckoutPaymentMethod, "flow" | "name">;
type RedirectMethodId = Extract<CheckoutPaymentMethod["id"], "paypal" | "razorpay" | "paystack" | "pesapal" | "orange_money">;
type PushMethodId = Extract<CheckoutPaymentMethod["id"], "mtn_momo" | "iotec">;

/**
 * Every method the app may be offered, in the order it shows them: how it is
 * paid and what it is called. A gateway is listed only once the store has
 * switched it on; cash on delivery and the card always are.
 */
const PAYMENT_METHODS: ReadonlyArray<
  Pick<CheckoutPaymentMethod, "id" | "flow" | "name"> & {
    answer: (priced: PricedCheckout, ctx: MethodContext) => MethodAnswer | null;
  }
> = [
  { id: "cod", flow: "cod", name: "Cash on delivery", answer: (priced) => codMethod(priced) },
  { id: "card", flow: "card", name: "Card", answer: (priced, ctx) => cardMethod(priced, ctx) },
  { id: "paypal", flow: "redirect", name: "PayPal", answer: (priced, ctx) => redirectMethod("paypal", priced, ctx) },
  { id: "razorpay", flow: "redirect", name: "Razorpay", answer: (priced, ctx) => redirectMethod("razorpay", priced, ctx) },
  { id: "paystack", flow: "redirect", name: "Paystack", answer: (priced, ctx) => redirectMethod("paystack", priced, ctx) },
  { id: "pesapal", flow: "redirect", name: "Pesapal", answer: (priced, ctx) => redirectMethod("pesapal", priced, ctx) },
  {
    id: "orange_money",
    flow: "redirect",
    name: "Orange Money",
    answer: (priced, ctx) => redirectMethod("orange_money", priced, ctx),
  },
  { id: "mtn_momo", flow: "push", name: "MTN MoMo", answer: (priced, ctx) => pushMethod("mtn_momo", priced, ctx) },
  { id: "iotec", flow: "push", name: "ioTec Pay", answer: (priced, ctx) => pushMethod("iotec", priced, ctx) },
];

interface MethodContext {
  readiness: ReturnType<typeof resolveCheckoutGatewayReadiness>;
  appScheme: string;
}

function paymentMethodsOf(priced: PricedCheckout, appScheme: string): CheckoutPaymentMethod[] {
  const ctx: MethodContext = { readiness: resolveCheckoutGatewayReadiness(priced.settings), appScheme };
  return PAYMENT_METHODS.flatMap(({ id, flow, name, answer }) => {
    const answered = answer(priced, ctx);
    return answered ? [{ ...answered, id, flow, name }] : [];
  });
}

/** Whether cash on delivery can take this order, by the rule that refuses it. */
function codMethod(priced: PricedCheckout): MethodAnswer {
  const cod = priced.settings.payment?.cod;
  const refuse = (reason: string, message: string): MethodAnswer => ({
    id: "cod",
    available: false,
    reason,
    message,
  });
  // In the order lib/checkout/cod-eligibility.ts refuses them.
  if (cod?.enabled === false) return refuse("DISABLED", "Cash on Delivery is disabled");
  if (priced.hasDigitalItems) {
    return refuse(
      "DIGITAL_ITEMS",
      "Cash on Delivery is not available for orders that include digital items",
    );
  }
  const breach = codLimitBreach({
    total: priced.total,
    minOrderAmount: cod?.minOrderAmount,
    maxOrderAmount: cod?.maxOrderAmount,
  });
  if (breach === "below_minimum") {
    return refuse("BELOW_MINIMUM", `Minimum order amount for Cash on Delivery is ${cod?.minOrderAmount}`);
  }
  if (breach === "above_maximum") {
    return refuse("ABOVE_MAXIMUM", `Maximum order amount for Cash on Delivery is ${cod?.maxOrderAmount}`);
  }
  return { id: "cod", available: true };
}

/** Whether the card can take it: Stripe switched on, its keys in, the currency its. */
function cardMethod(priced: PricedCheckout, ctx: MethodContext): MethodAnswer {
  if (!priced.settings.payment?.stripe?.enabled) {
    return { id: "card", available: false, reason: "DISABLED", message: "Card payments are not available" };
  }
  const readiness: CheckoutGatewayReadiness = ctx.readiness.stripe;
  if (!readiness.ready) {
    return {
      id: "card",
      available: false,
      reason: "NOT_CONFIGURED",
      message: "Card payments are not available",
    };
  }
  return { id: "card", available: true };
}

/**
 * Whether a gateway's own page can take it: switched on (else not listed),
 * its keys in, the currency its, and a way back to the app (its scheme).
 */
function redirectMethod(id: RedirectMethodId, priced: PricedCheckout, ctx: MethodContext): MethodAnswer | null {
  if (!priced.settings.payment?.[id]?.enabled) return null;
  if (!ctx.readiness[id].ready || !isValidAppScheme(ctx.appScheme)) {
    return { id, available: false, reason: "NOT_CONFIGURED", message: "This payment method is not available" };
  }
  return { id, available: true };
}

/**
 * Whether a mobile-money provider can take it: switched on (else not listed),
 * its keys in, the store's currency one it settles — and, for ioTec, at least
 * its minimum. The order the push start refuses them in
 * (lib/checkout/gateway-start/).
 */
function pushMethod(id: PushMethodId, priced: PricedCheckout, ctx: MethodContext): MethodAnswer | null {
  if (!priced.settings.payment?.[id]?.enabled) return null;
  if (!ctx.readiness[id].ready) {
    return { id, available: false, reason: "NOT_CONFIGURED", message: "This payment method is not available" };
  }
  if (id === "iotec" && Math.round(priced.paymentDueNow) < IOTEC_MIN_AMOUNT) {
    return {
      id,
      available: false,
      reason: "BELOW_MINIMUM",
      message: `ioTec Pay requires a minimum amount of ${IOTEC_MIN_AMOUNT} ${priced.settings.general?.defaultCurrency || "UGX"}.`,
    };
  }
  return { id, available: true };
}

function formOf(checkout: CheckoutSettings, ctx: QuoteContext, country: string | undefined): CheckoutForm {
  const label = (value: string) => (value.trim() ? { label: value } : {});
  const link = (href: string) =>
    /^https?:\/\//i.test(href)
      ? href
      : `${ctx.origin}${buildLocalePath(ctx.locale, href.startsWith("/") ? href : `/${href}`, ctx.storeDefault)}`;
  return {
    contactMode: checkout.contact.mode,
    guestCheckout: checkout.accounts.guestCheckout,
    addressFields: Object.fromEntries(
      CONFIGURABLE_ADDRESS_FIELDS.map((field) => [
        field,
        { visibility: checkout.fields[field].visibility, ...label(checkout.fields[field].label) },
      ]),
    ),
    orderNote: { visibility: checkout.orderNote.visibility, ...label(checkout.orderNote.label) },
    customFields: checkout.customFields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      placement: field.placement,
      visibility: field.visibility,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(field.helpText ? { helpText: field.helpText } : {}),
      options: field.options,
    })),
    marketing: {
      email: {
        offered: checkout.contact.marketingOptIn.enabled,
        ...label(checkout.contact.marketingOptIn.label),
        defaultChecked: marketingBoxDefaultChecked(checkout.contact.marketingOptIn, country),
      },
      sms: {
        offered: checkout.contact.smsOptIn.enabled,
        ...label(checkout.contact.smsOptIn.label),
        ...(checkout.contact.smsOptIn.fineprint ? { fineprint: checkout.contact.smsOptIn.fineprint } : {}),
      },
    },
    policyLinks: checkout.policyLinks
      .filter((entry) => entry.visible && entry.href.trim() && entry.label.trim())
      .map((entry) => ({ label: entry.label, url: link(entry.href.trim()) })),
  };
}

/**
 * Whether everything that decides the money is known: delivery priced (or
 * none needed). Only then does the quote carry a hash to place it with.
 */
function moneySettled(shipping: CheckoutShipping): boolean {
  return shipping.status === "READY" || shipping.status === "NOT_REQUIRED";
}

export function toCheckoutQuote(priced: PricedCheckout, ctx: QuoteContext): CheckoutQuote {
  const currency = resolveCurrency(priced.settings.general?.defaultCurrency || "USD");
  const money = (amount: number) => toMoney(amount, currency);

  const lines: CheckoutQuoteLine[] = priced.items.map((item) => {
    const productId = idOf(item.productId);
    const variantId = item.variantId ? String(item.variantId) : undefined;
    const changed = priced.priceChanges.find(
      (change) => change.productId === productId && (change.variantId ?? undefined) === variantId,
    );
    const stored = item as unknown as { name?: string; image?: string };
    const image = imageSet(stored.image ?? item.productId.images?.[0]);
    const slug = item.productId.slug?.trim();
    return {
      key: cartLineKeyOf(productId, variantId),
      productId,
      ...(slug ? { slug } : {}),
      ...(variantId ? { variantId } : {}),
      name: stored.name || item.productId.name,
      ...(image ? { image } : {}),
      quantity: item.quantity,
      unitPrice: money(item.price),
      lineTotal: money(item.price * item.quantity),
      ...(changed ? { previousUnitPrice: money(changed.previousPrice) } : {}),
    };
  });

  const shipping = shippingOf(priced, money);
  const deliveryPriced = shipping.status === "READY";
  const cardTesting = priced.cardTesting;
  const siteKey = turnstileSiteKey(priced.settings);
  const couponMessage = priced.couponError
    ? priced.couponError.errors.code?.[0] ?? priced.couponError.message
    : undefined;

  return {
    currency: currency.code,
    lines,
    itemCount: priced.items.reduce((sum, item) => sum + item.quantity, 0),
    shipping,
    ...(priced.appliedCoupon
      ? {
          coupon: {
            code: priced.appliedCoupon.code,
            status: "APPLIED" as const,
            discount: money(priced.discount),
          },
        }
      : priced.couponError && ctx.couponCode
        ? {
            coupon: {
              code: ctx.couponCode,
              status: "INVALID" as const,
              ...(couponMessage ? { message: couponMessage } : {}),
              ...couponRefusalOf(ctx.couponRefusal, currency),
            },
          }
        : {}),
    totals: {
      subtotal: money(priced.subtotal),
      discount: money(priced.discount),
      ...(deliveryPriced ? { shipping: money(priced.shippingCost) } : {}),
      ...(priced.dutyAmount > 0 ? { duty: money(priced.dutyAmount) } : {}),
      tax: money(priced.tax),
      total: money(priced.total),
      dueNow: money(priced.paymentDueNow),
    },
    paymentMethods: paymentMethodsOf(priced, ctx.appScheme),
    captcha: {
      required: Boolean(cardTesting?.requireCaptcha && siteKey),
      ...(siteKey ? { url: `${ctx.origin}/app/captcha` } : {}),
    },
    paymentsPaused: Boolean(cardTesting?.blocked),
    form: formOf(
      priced.submission.checkout,
      ctx,
      priced.normalizedShippingAddress.country || undefined,
    ),
    fieldErrors: { ...ctx.schemaErrors, ...priced.formErrors },
    ...(moneySettled(shipping)
      ? { quoteHash: checkoutQuoteHash(checkoutFiguresOf(priced)) }
      : {}),
  };
}
