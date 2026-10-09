/**
 * Checkout: the quote (a dry run of placing the order), placing a cash-on-
 * delivery order, and the card payment. Placing an order and starting a card
 * payment carry an `Idempotency-Key`, so a retry after a lost answer returns
 * the first answer instead of a second order.
 *
 * The flow:
 * 1. POST /checkout/quote, again whenever the shopper changes something that
 *    could change the bill (address, delivery option, coupon). The answer is
 *    the order as it would be placed: live prices, delivery, totals, which
 *    payment methods can take it, the form the store asks for and what of it
 *    is still missing. Once everything that decides the money is known it
 *    carries a `quoteHash`.
 * 2. Cash on delivery: POST /checkout/orders with the same body, the
 *    `quoteHash` and an `Idempotency-Key`.
 *    Card: POST /checkout/stripe/intent (same body, `quoteHash`,
 *    `Idempotency-Key`) → Stripe's PaymentSheet → POST
 *    /checkout/stripe/confirm. Stripe's webhook writes the order; confirm
 *    reports it, and writes it itself when the webhook has not yet.
 * 3. A figure that moved since the quote (a price, a delivery rate, a
 *    coupon's worth): 409 CONFLICT, reason PRICES_CHANGED, the new quote in
 *    `details.quote` (`PricesChangedDetails`). Show it; the shopper places
 *    again with its hash.
 * 4. A gateway's own page (`CheckoutPaymentMethod.flow` "redirect": PayPal,
 *    Razorpay, Paystack, Pesapal, Orange Money): POST /checkout/redirect, open
 *    its `url` in the in-app browser, then POST /checkout/redirect/verify —
 *    see `RedirectPaymentRequest`.
 * 5. Mobile money (`PUSH_PAYMENT_METHODS`): POST /checkout/push, then POST
 *    /checkout/push/verify while the shopper approves on their phone — see
 *    `PushPaymentRequest`.
 *
 * The app never adds up money: every figure here is the server's.
 *
 * A guest checks out the cart of their `X-Cart-Token`, a signed-in shopper
 * their account's cart. Keep one `Idempotency-Key` per tap of "Place order"
 * until it has an answer, and send it again with every retry of that tap.
 */
import * as z from "zod";

import { ImageSet, Money } from "./common";

/**
 * `reason` values of the checkout endpoints, next to the error `code`:
 * - 409 CONFLICT: PRICES_CHANGED, CART_EMPTY, OUT_OF_STOCK, NOT_AVAILABLE,
 *   PRE_ORDER, NOT_PURCHASABLE_IN_APP, PICKUP_NOT_SUPPORTED,
 *   SHIPPING_UNAVAILABLE, PAYMENT_METHOD_UNAVAILABLE, PAYMENT_FAILED,
 *   PAYMENT_PENDING.
 * - 401 AUTHENTICATION_ERROR: SIGN_IN_REQUIRED (a guest, where the store sells to signed-in shoppers only).
 * - 400 VALIDATION_ERROR: COUPON_INVALID (on `errors.couponCode`, with the
 *   coupon's own reason in `details`: `CouponInvalidDetails`, coupons.ts),
 *   CAPTCHA_REQUIRED (on `errors.turnstileToken`), PHONE_INVALID (on
 *   `errors.payerPhone`); any other field error comes without a reason,
 *   keyed by the field it is about.
 * - 429 RATE_LIMIT_EXCEEDED: PAYMENTS_PAUSED.
 */
export const CHECKOUT_REASONS = [
  /** The order is not what the quote said any more: `PricesChangedDetails`. */
  "PRICES_CHANGED",
  /** Nothing in the cart. */
  "CART_EMPTY",
  /** A line sold out, or fewer are left than the cart holds. */
  "OUT_OF_STOCK",
  /** A product, or its seller, is no longer selling. */
  "NOT_AVAILABLE",
  /** The cart holds pre-orders, which the app cannot place yet: `CheckoutLinesDetails`. */
  "PRE_ORDER",
  /** The store does not sell these lines inside the app (digital goods): `CheckoutLinesDetails`. */
  "NOT_PURCHASABLE_IN_APP",
  /** Collecting from a branch is not offered in the app yet. */
  "PICKUP_NOT_SUPPORTED",
  /** The store does not deliver to this address. */
  "SHIPPING_UNAVAILABLE",
  /** The payment method cannot take this order (switched off, a limit, digital goods). */
  "PAYMENT_METHOD_UNAVAILABLE",
  /** The coupon does not apply: why is `details.couponReason` (`CouponInvalidDetails`). */
  "COUPON_INVALID",
  /** Too many refused cards: complete the human check (`CheckoutCaptcha`) and send `turnstileToken`. */
  "CAPTCHA_REQUIRED",
  /** Too many refused cards: payments from this shopper are paused for a while. */
  "PAYMENTS_PAUSED",
  /** The payment provider refused to start the payment: nothing was charged and no order is left. */
  "PAYMENT_FAILED",
  /** The store takes orders from signed-in shoppers only (`CheckoutForm.guestCheckout` false): sign in, then place. */
  "SIGN_IN_REQUIRED",
  /** The mobile-money number cannot be prompted: fix `payerPhone`. */
  "PHONE_INVALID",
  /** An earlier payment request from this shopper is still waiting on their phone: `PushPayment` in `details`. */
  "PAYMENT_PENDING",
] as const;
export const CheckoutReason = z.enum(CHECKOUT_REASONS);
export type CheckoutReason = z.infer<typeof CheckoutReason>;

/** The `details` of PRE_ORDER and NOT_PURCHASABLE_IN_APP: the cart lines (`CartLine.key`). */
export const CheckoutLinesDetails = z.object({
  lines: z.array(z.string()),
});
export type CheckoutLinesDetails = z.infer<typeof CheckoutLinesDetails>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const QuoteAddressBody = z.object({
  /** Sent, or made from firstName and lastName. */
  fullName: z.string().max(100).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  street: z.string().max(200).optional(),
  apartment: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  /** As the store's country list writes it. */
  country: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
});

/**
 * POST /checkout/quote. Everything is optional: ask while the shopper fills
 * the form in. Without a delivery address (street, city and country) the
 * quote is priced without delivery (`CheckoutShipping.status`
 * NEEDS_ADDRESS).
 */
export const CheckoutQuoteRequest = z.object({
  /** Where to deliver. Leave out for a cart that ships nothing. */
  shippingAddress: QuoteAddressBody.optional(),
  /** Defaults to the delivery address. A cart that ships nothing needs only this. */
  billingAddress: QuoteAddressBody.optional(),
  /** Defaults to the signed-in shopper's. */
  email: z.string().max(254).optional(),
  phone: z.string().max(30).optional(),
  couponCode: z.string().max(20).optional(),
  /** `CheckoutShippingOption.id`, for an order delivered in one shipment. */
  selectedShippingOptionId: z.string().max(100).optional(),
  /** Seller id → `CheckoutShippingOption.id`, for an order its sellers ship. */
  vendorShippingSelections: z.record(z.string(), z.string().max(100)).optional(),
  /** "pickup" is refused in v1 (PICKUP_NOT_SUPPORTED). */
  fulfillmentMethod: z.enum(["delivery", "pickup"]).optional(),
  customerNote: z.string().max(2000).optional(),
  /** `CheckoutCustomField.id` → the answer. */
  customFields: z
    .record(z.string().max(50), z.union([z.string().max(2000), z.boolean(), z.number()]))
    .optional(),
  /** Lets the form ask for what this method needs; leave out until chosen. */
  paymentMethod: z.enum(["cod", "card", "paypal", "razorpay", "paystack", "pesapal", "orange_money", "mtn_momo", "iotec"]).optional(),
  /** The "email me with news and offers" box, when `CheckoutMarketing.email.offered`. */
  buyerAcceptsMarketing: z.boolean().optional(),
  /** The "text me with news and offers" box, when `CheckoutMarketing.sms.offered`. */
  smsAcceptsMarketing: z.boolean().optional(),
});
export type CheckoutQuoteRequest = z.infer<typeof CheckoutQuoteRequest>;

const PlaceAddressBody = QuoteAddressBody.extend({
  street: z.string().max(200),
  city: z.string().max(100),
  country: z.string().max(100),
});

const PlaceFields = {
  shippingAddress: PlaceAddressBody.optional(),
  billingAddress: PlaceAddressBody.optional(),
  /** The `quoteHash` of the quote the shopper accepted. */
  quoteHash: z.string().min(1).max(64),
  /** From the human check, when the quote asked for one (`CheckoutCaptcha`). */
  turnstileToken: z.string().max(4000).optional(),
};

/** POST /checkout/orders: cash on delivery. Send `Idempotency-Key`. */
export const PlaceOrderRequest = CheckoutQuoteRequest.omit({ paymentMethod: true }).extend(PlaceFields);
export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequest>;

/** POST /checkout/stripe/intent: start a card payment. Send `Idempotency-Key`. */
export const StripeIntentRequest = CheckoutQuoteRequest.omit({ paymentMethod: true }).extend(PlaceFields);
export type StripeIntentRequest = z.infer<typeof StripeIntentRequest>;

/** POST /checkout/stripe/confirm, after PaymentSheet closes with success. */
export const StripeConfirmRequest = z.object({
  paymentIntentId: z.string().min(1).max(255),
});
export type StripeConfirmRequest = z.infer<typeof StripeConfirmRequest>;

// ---------------------------------------------------------------------------
// The quote
// ---------------------------------------------------------------------------

export const CheckoutQuoteLine = z.object({
  /** The cart line's key (`CartLine.key`). */
  key: z.string(),
  productId: z.string(),
  /** The product's page: GET /products/{slug}. Left out when the product has no address. */
  slug: z.string().optional(),
  variantId: z.string().optional(),
  name: z.string(),
  image: ImageSet.optional(),
  quantity: z.number().int(),
  /** The live price, which the order is placed at. */
  unitPrice: Money,
  lineTotal: Money,
  /** The price the cart held, when the live one differs: show the change. */
  previousUnitPrice: Money.optional(),
});
export type CheckoutQuoteLine = z.infer<typeof CheckoutQuoteLine>;

export const CheckoutShippingOption = z.object({
  /** Send back as `selectedShippingOptionId` (or in `vendorShippingSelections`). */
  id: z.string(),
  name: z.string(),
  price: Money,
  minDays: z.number().int().optional(),
  maxDays: z.number().int().optional(),
});
export type CheckoutShippingOption = z.infer<typeof CheckoutShippingOption>;

/** One seller's delivery, for an order its sellers ship themselves. */
export const CheckoutSellerShipping = z.object({
  vendorId: z.string(),
  name: z.string().optional(),
  options: z.array(CheckoutShippingOption),
  selectedOptionId: z.string().optional(),
  price: Money,
});
export type CheckoutSellerShipping = z.infer<typeof CheckoutSellerShipping>;

export const CHECKOUT_SHIPPING_STATUSES = [
  /** Nothing in the cart ships. */
  "NOT_REQUIRED",
  /** Street, city and country are needed before delivery can be priced. */
  "NEEDS_ADDRESS",
  /** Priced: `options` (or `sellers`) and the selected one. */
  "READY",
  /** The store does not deliver to this address. */
  "UNAVAILABLE",
] as const;

export const CheckoutShipping = z.object({
  status: z.enum(CHECKOUT_SHIPPING_STATUSES),
  /** One shipment: the options, and `selectedOptionId` among them. */
  options: z.array(CheckoutShippingOption),
  selectedOptionId: z.string().optional(),
  /** Shipped by its sellers: one entry per seller, each with its own choice. */
  sellers: z.array(CheckoutSellerShipping),
});
export type CheckoutShipping = z.infer<typeof CheckoutShipping>;

export const CheckoutCoupon = z.object({
  code: z.string(),
  status: z.enum(["APPLIED", "INVALID"]),
  /** What it takes off, when applied. */
  discount: Money.optional(),
  /** Why it does not apply, in English; show your own words for COUPON_INVALID. */
  message: z.string().optional(),
  /** INVALID: why, as a word of `COUPON_REASONS` (coupons.ts). */
  reason: z.string().optional(),
  /** INVALID: `reason` in the store's words, in the path's locale. Print it. */
  reasonMessage: z.string().optional(),
  /** INVALID for MINIMUM_NOT_MET: what the cart is short of. */
  shortBy: Money.optional(),
});
export type CheckoutCoupon = z.infer<typeof CheckoutCoupon>;

export const CheckoutTotals = z.object({
  subtotal: Money,
  discount: Money,
  /** Left out until delivery is priced (`CheckoutShipping.status`). */
  shipping: Money.optional(),
  /** Import duties collected now, when there are any. */
  duty: Money.optional(),
  tax: Money,
  total: Money,
  /** What is paid now: by card, or to the courier. */
  dueNow: Money,
});
export type CheckoutTotals = z.infer<typeof CheckoutTotals>;

export const CHECKOUT_PAYMENT_METHODS = [
  "cod",
  "card",
  "paypal",
  "razorpay",
  "paystack",
  "pesapal",
  "orange_money",
  "mtn_momo",
  "iotec",
] as const;

/**
 * How a method is paid, which decides the app's screen — never the method's
 * id, so a method the app does not know yet still works if its flow is one
 * it knows:
 * - `cod`: nothing to pay now — POST /checkout/orders.
 * - `card`: Stripe's PaymentSheet — POST /checkout/stripe/intent.
 * - `redirect`: the gateway's own page in the in-app browser —
 *   POST /checkout/redirect.
 * - `push`: an approval on the shopper's phone.
 * Leave out a method whose flow you do not know.
 */
export const CHECKOUT_PAYMENT_FLOWS = ["cod", "card", "redirect", "push"] as const;

export const CheckoutPaymentMethod = z.object({
  id: z.enum(CHECKOUT_PAYMENT_METHODS),
  flow: z.enum(CHECKOUT_PAYMENT_FLOWS),
  /** The method's name to show ("PayPal", "Cash on delivery"), in English. */
  name: z.string(),
  available: z.boolean(),
  /**
   * Why it cannot take this order, when it cannot:
   * DISABLED, NOT_CONFIGURED, DIGITAL_ITEMS, BELOW_MINIMUM, ABOVE_MAXIMUM.
   * mtn_momo and iotec are paid on the shopper's phone: POST /checkout/push.
   * A value you do not know: show `message`.
   */
  reason: z.string().optional(),
  message: z.string().optional(),
});
export type CheckoutPaymentMethod = z.infer<typeof CheckoutPaymentMethod>;

/**
 * The human check. When `required`, open `url` in a WebView before paying.
 * The page posts JSON to the app (`window.ReactNativeWebView.postMessage`),
 * always with the `nonce` it was opened with:
 * - `{ type: "turnstile", token }`: send `token` as `turnstileToken`. It is
 *   good once, for a few minutes.
 * - `{ type: "turnstile-expired" }`: the token lapsed; the page shows a new check.
 * - `{ type: "turnstile-error" }`: the check could not load; offer to retry.
 * - `{ type: "turnstile-unavailable" }`: the store has no check (not asked then).
 */
export const CheckoutCaptcha = z.object({
  required: z.boolean(),
  /** The store's page that shows the check. Add `?nonce=` with a value of your own. */
  url: z.string().optional(),
});
export type CheckoutCaptcha = z.infer<typeof CheckoutCaptcha>;

export const CHECKOUT_FIELD_VISIBILITIES = ["required", "optional", "hidden"] as const;
const FieldVisibility = z.enum(CHECKOUT_FIELD_VISIBILITIES);

/** A field of the store's form: show it unless hidden, require it when required. */
export const CheckoutFormField = z.object({
  visibility: FieldVisibility,
  /** The store's own label; left out for the field's usual name. */
  label: z.string().optional(),
});
export type CheckoutFormField = z.infer<typeof CheckoutFormField>;

export const CheckoutCustomField = z.object({
  /** Send the answer under this id in `customFields`. */
  id: z.string(),
  label: z.string(),
  /** text, textarea, number, email, phone, date, select, checkbox; show another as text. */
  type: z.string(),
  /** contact, delivery or additional: where on the form it goes. */
  placement: z.string(),
  visibility: FieldVisibility,
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  /** The choices of a select. */
  options: z.array(z.string()),
});
export type CheckoutCustomField = z.infer<typeof CheckoutCustomField>;

export const CheckoutMarketing = z.object({
  email: z.object({
    offered: z.boolean(),
    label: z.string().optional(),
    /** Ticked to begin with: the store's rule for the delivery country. */
    defaultChecked: z.boolean(),
  }),
  sms: z.object({
    offered: z.boolean(),
    label: z.string().optional(),
    fineprint: z.string().optional(),
  }),
});
export type CheckoutMarketing = z.infer<typeof CheckoutMarketing>;

/** The form the store asks for (Settings → Checkout). */
export const CheckoutForm = z.object({
  /** email, phone, email_or_phone or email_and_phone: how the shopper is reached. */
  contactMode: z.string(),
  /** False: only a signed-in shopper may order. */
  guestCheckout: z.boolean(),
  /** firstName, lastName, apartment, postalCode, state, phone. Street, city and country are always required. */
  addressFields: z.record(z.string(), CheckoutFormField),
  orderNote: CheckoutFormField,
  customFields: z.array(CheckoutCustomField),
  marketing: CheckoutMarketing,
  /** The store's terms and policies, linked under the button. */
  policyLinks: z.array(z.object({ label: z.string(), url: z.string() })),
});
export type CheckoutForm = z.infer<typeof CheckoutForm>;

/** POST /checkout/quote */
export const CheckoutQuote = z.object({
  currency: z.string(),
  lines: z.array(CheckoutQuoteLine),
  itemCount: z.number().int(),
  shipping: CheckoutShipping,
  coupon: CheckoutCoupon.optional(),
  totals: CheckoutTotals,
  paymentMethods: z.array(CheckoutPaymentMethod),
  captcha: CheckoutCaptcha,
  /** Payments from this shopper are paused (PAYMENTS_PAUSED): placing will be refused. */
  paymentsPaused: z.boolean(),
  form: CheckoutForm,
  /**
   * What placing the order would refuse in the form as it stands, keyed like
   * the request ("shippingAddress.postalCode", "email", "customFields.cf_gift").
   * Empty when nothing is missing.
   */
  fieldErrors: z.record(z.string(), z.array(z.string())),
  /**
   * Sent once everything that decides the money is known: send it back to
   * place the order. Left out while delivery is not priced.
   */
  quoteHash: z.string().optional(),
});
export type CheckoutQuote = z.infer<typeof CheckoutQuote>;

/** The `details` of PRICES_CHANGED. */
export const PricesChangedDetails = z.object({
  quote: CheckoutQuote,
});
export type PricesChangedDetails = z.infer<typeof PricesChangedDetails>;

// ---------------------------------------------------------------------------
// Placing and paying
// ---------------------------------------------------------------------------

/** POST /checkout/orders (201): the order, placed. Show its number. */
export const PlacedOrder = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  paymentMethod: z.literal("cod"),
  /** What the courier collects. */
  total: Money,
});
export type PlacedOrder = z.infer<typeof PlacedOrder>;

/**
 * A signed-in shopper's Stripe Customer, so PaymentSheet lists, reuses, saves
 * and removes their cards. Pass `id` as `customerId` and exactly one of the
 * two secrets: `customerSessionClientSecret` when it is sent, else
 * `customerEphemeralKeySecret`. With neither, set up the sheet without a
 * customer.
 */
export const StripeSheetCustomer = z.object({
  /** PaymentSheet's `customerId`. */
  id: z.string(),
  /** PaymentSheet's `customerSessionClientSecret` (preferred). */
  customerSessionClientSecret: z.string().optional(),
  /** PaymentSheet's `customerEphemeralKeySecret`, sent only when no customer session could be made. */
  ephemeralKeySecret: z.string().optional(),
});
export type StripeSheetCustomer = z.infer<typeof StripeSheetCustomer>;

/**
 * POST /checkout/stripe/intent: what PaymentSheet is set up with. Also the
 * `card` part of POST /orders/{id}/pay.
 *
 * `initStripe({ publishableKey, merchantIdentifier })`, then
 * `initPaymentSheet` with:
 * - `paymentIntentClientSecret`: `clientSecret`;
 * - `merchantDisplayName`: `merchantDisplayName`;
 * - `applePay: { merchantCountryCode }` and `googlePay: { merchantCountryCode,
 *   testEnv: testMode }`, when `merchantCountryCode` is sent (leave the
 *   wallets off without it);
 * - `customerId` and `customerSessionClientSecret` (or
 *   `customerEphemeralKeySecret`) from `customer`, when it is sent.
 *
 * `merchantCountryCode`, `testMode` and `customer` are optional: an app
 * that ignores them gets the sheet it had. A guest is never sent `customer`.
 */
export const StripeIntent = z.object({
  paymentIntentId: z.string(),
  /** PaymentSheet's `paymentIntentClientSecret`. */
  clientSecret: z.string(),
  /** The store's Stripe publishable key, for `initStripe`. */
  publishableKey: z.string(),
  /** PaymentSheet's `merchantDisplayName`: the store's name. */
  merchantDisplayName: z.string(),
  /** What the card is charged. */
  amount: Money,
  /**
   * The Stripe account's country (ISO 3166-1 alpha-2, "US"): PaymentSheet's
   * `applePay.merchantCountryCode` and `googlePay.merchantCountryCode`.
   * Left out when Stripe could not be asked; offer no wallet then.
   */
  merchantCountryCode: z.string().optional(),
  /** The store's keys are Stripe test keys: `googlePay.testEnv`. Left out when the key does not say. */
  testMode: z.boolean().optional(),
  /** A signed-in shopper's Customer, for their saved cards. Never sent for a guest. */
  customer: StripeSheetCustomer.optional(),
});
export type StripeIntent = z.infer<typeof StripeIntent>;

export const STRIPE_PAYMENT_OUTCOMES = [
  /** The order is placed. */
  "ORDER_PLACED",
  /** The payment arrived, but the goods sold out meanwhile: refunded, no order. */
  "ORDER_CANCELLED",
  /** The payment could not become an order and was sent back. */
  "PAYMENT_RETURNED",
  /** Not finished yet (Stripe is still confirming): ask again shortly. */
  "PENDING",
  /** The card was not charged: PaymentSheet's own error explains why. */
  "NOT_PAID",
] as const;

/** POST /checkout/stripe/confirm */
export const StripeConfirmation = z.object({
  outcome: z.enum(STRIPE_PAYMENT_OUTCOMES),
  /** Stripe's status of the PaymentIntent. */
  paymentStatus: z.string(),
  orderId: z.string().optional(),
  orderNumber: z.string().optional(),
  /** Sent back to the card, when anything was. */
  refunded: Money.optional(),
});
export type StripeConfirmation = z.infer<typeof StripeConfirmation>;

// ---------------------------------------------------------------------------
// Paying on a gateway's own page (redirect)
// ---------------------------------------------------------------------------

/**
 * The payment methods paid on the gateway's own page, opened in the in-app
 * browser (`flow` "redirect").
 *
 * 1. POST /checkout/redirect: the place body, `paymentMethod`, the
 *    `quoteHash` and an `Idempotency-Key` → `RedirectPayment`.
 * 2. `WebBrowser.openAuthSessionAsync(url, returnUrl)`. The shopper pays (or
 *    gives up); the gateway sends the browser to the store, which sends it on
 *    to `returnUrl` — the app link `{scheme}://checkout/return/{provider}`,
 *    with what the gateway handed back in its query — and the browser closes.
 * 3. POST /checkout/redirect/verify with the `reference` and that query as
 *    `returnParams` — also when the browser was closed without coming back
 *    (the money may have moved), and again when the app next opens if the
 *    answer was PENDING.
 *
 * The order is written before the payment or when the money arrives,
 * depending on the store's settings: `RedirectPayment.orderId` says which.
 * The cart is emptied when the money arrives, not before.
 */
export const REDIRECT_PAYMENT_METHODS = ["paypal", "razorpay", "paystack", "pesapal", "orange_money"] as const;
export const RedirectPaymentMethod = z.enum(REDIRECT_PAYMENT_METHODS);
export type RedirectPaymentMethod = z.infer<typeof RedirectPaymentMethod>;

/**
 * POST /checkout/redirect. Send `Idempotency-Key`: a retry answers with the
 * same payment; a new tap for the same cart is sent back to the gateway page
 * it already made while that page can still be paid (`resumed`).
 *
 * Refusals, besides the checkout's: 409 PAYMENT_METHOD_UNAVAILABLE (the
 * method is off, has no keys, or does not take the store's currency); 409
 * PAYMENT_FAILED, the gateway refused to start (nothing is left behind).
 */
export const RedirectPaymentRequest = CheckoutQuoteRequest.omit({ paymentMethod: true }).extend({
  ...PlaceFields,
  paymentMethod: RedirectPaymentMethod,
});
export type RedirectPaymentRequest = z.infer<typeof RedirectPaymentRequest>;

/** POST /checkout/redirect: the gateway page, and how to come back from it. */
export const RedirectPayment = z.object({
  paymentMethod: RedirectPaymentMethod,
  /** Open it in the in-app browser. */
  url: z.string(),
  /**
   * The app link the store sends the browser to when the shopper is done:
   * `openAuthSessionAsync`'s redirect URL.
   */
  returnUrl: z.string(),
  /** Send it to POST /checkout/redirect/verify. Good only for this shopper (or this cart). */
  reference: z.string(),
  /** What the gateway is asked to collect. */
  amount: Money,
  /** Set when the order is written before the payment; otherwise it is written when the money arrives. */
  orderId: z.string().optional(),
  orderNumber: z.string().optional(),
  /** This cart's gateway page from an earlier tap, still payable, rather than a new one. */
  resumed: z.boolean(),
});
export type RedirectPayment = z.infer<typeof RedirectPayment>;

/** POST /checkout/redirect/verify */
export const RedirectVerifyRequest = z.object({
  paymentMethod: RedirectPaymentMethod,
  /** `RedirectPayment.reference`. */
  reference: z.string().min(1).max(300),
  /**
   * The query of the app link the browser came back on, as it arrived (the
   * store passes on only what the gateway needs). Leave out when the browser
   * was closed without coming back.
   */
  returnParams: z.record(z.string().max(64), z.string().max(1000)).optional(),
});
export type RedirectVerifyRequest = z.infer<typeof RedirectVerifyRequest>;

export const REDIRECT_PAYMENT_STATUSES = [
  /** The money arrived: the order is paid. */
  "PAID",
  /** Not finished at the gateway yet: ask again shortly, and when the app next opens. */
  "PENDING",
  /** The gateway refused or lost the payment: `reason`. Let the shopper choose again. */
  "FAILED",
  /** The shopper gave up at the gateway, or the order was called off: `reason`, `refunded`. */
  "CANCELLED",
] as const;

/**
 * POST /checkout/redirect/verify: what the gateway says now. A reference that
 * is not this shopper's (or this cart's) is 404.
 */
export const RedirectVerification = z.object({
  status: z.enum(REDIRECT_PAYMENT_STATUSES),
  /** The order: always once PAID, and before that when it was written first. */
  orderId: z.string().optional(),
  orderNumber: z.string().optional(),
  /**
   * FAILED or CANCELLED: why — DECLINED, EXPIRED, NOT_COMPLETED,
   * PAYER_CANCELLED, SOLD_OUT, ORDER_CANCELLED, CHECKOUT_CLOSED, REVERSED.
   * Show your own words; a code you do not know is a plain failure.
   */
  reason: z.string().optional(),
  /** CANCELLED after the money arrived (SOLD_OUT, ORDER_CANCELLED, CHECKOUT_CLOSED, REVERSED): it is being sent back. */
  refunded: z.boolean().optional(),
});
export type RedirectVerification = z.infer<typeof RedirectVerification>;

// ---------------------------------------------------------------------------
// Paying by mobile money (push)
// ---------------------------------------------------------------------------

/**
 * The payment methods that ask the shopper's phone: a PIN prompt goes to a
 * mobile-money number, the shopper approves it there, and the app asks how it
 * went. MTN MoMo, and ioTec (MTN and Airtel Money in Uganda).
 *
 * 1. POST /checkout/push: the place body, `paymentMethod`, the number to
 *    prompt (`payerPhone`), the `quoteHash` and an `Idempotency-Key`. The
 *    order is placed awaiting payment, and the prompt is on its way (201
 *    `PushPayment`).
 * 2. Show "Approve the payment on your phone" and POST /checkout/push/verify
 *    every `pollIntervalSeconds` until the status is not PENDING, or until
 *    `expiresAt`.
 * 3. PAID: done. FAILED: say why (`reason`) and let the shopper choose again.
 *    CANCELLED: the order was called off. Still PENDING at `expiresAt`: show
 *    the order as awaiting payment — the store keeps asking the provider and
 *    settles the order if the money arrives.
 *
 * The cart is emptied when the payment arrives, not before.
 */
export const PUSH_PAYMENT_METHODS = ["mtn_momo", "iotec"] as const;
export const PushPaymentMethod = z.enum(PUSH_PAYMENT_METHODS);
export type PushPaymentMethod = z.infer<typeof PushPaymentMethod>;

/**
 * POST /checkout/push. Send `Idempotency-Key`: a retry answers with the same
 * order and sends no second prompt.
 *
 * Refusals, besides the checkout's: 400 PHONE_INVALID (`errors.payerPhone`);
 * 409 PAYMENT_FAILED, the provider refused the request (no order is left);
 * 409 PAYMENT_PENDING, an earlier request of this shopper's is still waiting
 * on their phone — its `PushPayment` is in `details`: go back to it.
 */
export const PushPaymentRequest = CheckoutQuoteRequest.omit({ paymentMethod: true }).extend({
  ...PlaceFields,
  paymentMethod: PushPaymentMethod,
  /** The mobile-money number to prompt, as the shopper typed it. */
  payerPhone: z.string().min(1).max(30),
});
export type PushPaymentRequest = z.infer<typeof PushPaymentRequest>;

/** POST /checkout/push (201): the order, and the prompt to wait for. */
export const PushPayment = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  paymentMethod: PushPaymentMethod,
  /** Send it back to POST /checkout/push/verify. */
  reference: z.string(),
  /** What the phone is asked to pay. */
  amount: Money,
  /** When to stop asking (ISO 8601) and show the order as awaiting payment. */
  expiresAt: z.string(),
  /** How often to ask POST /checkout/push/verify, in seconds. */
  pollIntervalSeconds: z.number().int(),
});
export type PushPayment = z.infer<typeof PushPayment>;

/** POST /checkout/push/verify */
export const PushVerifyRequest = z.object({
  paymentMethod: PushPaymentMethod,
  /** `PushPayment.reference`. */
  reference: z.string().min(1).max(100),
});
export type PushVerifyRequest = z.infer<typeof PushVerifyRequest>;

export const PUSH_PAYMENT_STATUSES = [
  /** The money arrived: the order is paid. */
  "PAID",
  /** Not approved yet: ask again after `pollIntervalSeconds`. */
  "PENDING",
  /** Declined, expired or refused on the phone: `reason`. Nothing was charged. */
  "FAILED",
  /** The order was called off. */
  "CANCELLED",
] as const;

/**
 * POST /checkout/push/verify: what the provider says now. A reference that is
 * not this shopper's (or this cart's) is 404. 503 SERVICE_UNAVAILABLE: the
 * provider did not answer; ask again at the next poll.
 */
export const PushVerification = z.object({
  status: z.enum(PUSH_PAYMENT_STATUSES),
  orderId: z.string(),
  orderNumber: z.string(),
  /**
   * FAILED: the provider's own code, when it gave one — APPROVAL_REJECTED,
   * EXPIRED, NOT_ENOUGH_FUNDS, PAYER_NOT_FOUND, PAYER_LIMIT_REACHED, … Show
   * your own words; a code you do not know is a plain failure.
   */
  reason: z.string().optional(),
});
export type PushVerification = z.infer<typeof PushVerification>;
