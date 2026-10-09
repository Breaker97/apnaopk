import { createHash } from "node:crypto";

/**
 * The quote a shopper accepts, as one hash.
 *
 * The shopper app is shown a quote before it places an order or starts a card
 * payment, and sends back the quote's hash with the order. Placing
 * prices the cart again and must arrive at the same hash: a price, a rate, a
 * coupon's worth or the amount due that moved in between stops the order
 * before anything is written, where the web checkout instead compares the
 * cart's stored prices with the live ones (lib/checkout/cart-price-change.ts).
 *
 * Only what the shopper pays and for what is hashed — the lines at their
 * prices and every figure of the bill. Not the address or the contact: a new
 * delivery address that costs the same is the same order to pay for.
 *
 * Both pricings feed it — `prepareCheckout` (lib/checkout/prepare-checkout.ts)
 * and the card intent (lib/checkout/stripe-card-intent.ts) — so the quote the
 * app shows and the amount Stripe is asked for are held to each other.
 */

type FigureLine = {
  productId: { _id: unknown } | unknown;
  variantId?: unknown;
  quantity: number;
  price: number;
  purchaseType?: string;
  quoteId?: string;
};

type ShippingMethod = { optionId?: string } | undefined;

interface CheckoutFiguresSource {
  settings: { general?: { defaultCurrency?: string } | null };
  items: FigureLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  shippingCost: number;
  dutyAmount: number;
  paymentDueNow: number;
  storeCreditApplied: number;
  appliedCoupon?: { code: string } | undefined;
  selectedShippingMethod?: ShippingMethod;
  vendorShippingCosts: Map<string, { cost: number; method: ShippingMethod }>;
  pickupFulfillment?: { pickup?: { pickupLocationId?: string } } | undefined;
}

/** What a quote holds the shopper to, in a fixed order. */
export function checkoutFiguresOf(source: CheckoutFiguresSource) {
  const idOf = (value: unknown) =>
    value && typeof value === "object" && "_id" in value
      ? String((value as { _id: unknown })._id)
      : String(value ?? "");
  return {
    currency: (source.settings.general?.defaultCurrency || "USD").toUpperCase(),
    lines: source.items.map((item) => [
      idOf(item.productId),
      item.variantId ? String(item.variantId) : "",
      item.quantity,
      item.price,
      item.purchaseType || "standard",
      item.quoteId ? String(item.quoteId) : "",
    ]),
    subtotal: source.subtotal,
    discount: source.discount,
    shipping: source.shippingCost,
    duty: source.dutyAmount,
    tax: source.tax,
    total: source.total,
    dueNow: source.paymentDueNow,
    storeCredit: source.storeCreditApplied,
    coupon: source.appliedCoupon?.code ?? "",
    shippingOption: source.selectedShippingMethod?.optionId ?? "",
    vendorShipping: [...source.vendorShippingCosts]
      .map(([vendorId, entry]) => [vendorId, entry.method?.optionId ?? "", entry.cost])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    pickup: source.pickupFulfillment?.pickup?.pickupLocationId ?? "",
  };
}

type CheckoutFigures = ReturnType<typeof checkoutFiguresOf>;

/** The quote's hash: 32 characters, the same for the same figures on any server. */
export function checkoutQuoteHash(figures: CheckoutFigures): string {
  return createHash("sha256")
    .update(JSON.stringify(figures))
    .digest("base64url")
    .slice(0, 32);
}

/**
 * The order is no longer what the shopper accepted. Thrown before anything is
 * written; the caller answers with a fresh quote.
 */
export class CheckoutQuoteChangedError extends Error {
  constructor() {
    super("Your order total has changed. Review the new total, then place your order again.");
    this.name = "CheckoutQuoteChangedError";
  }
}
