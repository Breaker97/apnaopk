import { roundMoney } from "@/lib/intl/money";

/**
 * A cart line whose live price is not the one the shopper was shown.
 *
 * Both payment routes price a standard line from the live product, because a
 * cart lives for weeks and its stored price goes stale. They used to do it
 * silently: the checkout summary still showed the stored price, and the card
 * was charged the live one — a shopper looking at 27.59 paid 30.83. Now the
 * route stops before anything is charged, writes the live prices back to the
 * cart, and answers with this reason, so the page can show the new total and
 * let the shopper decide again.
 *
 * Kept free of server imports: the checkout page reads the reason too.
 */
export const CART_PRICES_CHANGED_REASON = "cart_prices_changed";

export const CART_PRICES_CHANGED_MESSAGE =
  "Some prices in your cart have changed. Review the updated total, then place your order again.";

export type CartPriceChange = {
  productId: string;
  variantId?: string;
  name: string;
  /** The price stored on the cart line, which is what the shopper saw. */
  previousPrice: number;
  price: number;
};

/**
 * Whether a line is about to be charged a different price from the one on
 * the shopper's screen. Compared in cents, so float residue is not a change.
 */
export function cartLinePriceChanged(shownPrice: unknown, livePrice: unknown) {
  const shown = Number(shownPrice);
  const live = Number(livePrice);
  if (!Number.isFinite(shown) || !Number.isFinite(live)) return false;
  return roundMoney(shown) !== roundMoney(live);
}

/** True for a payment route's refusal because cart prices changed. */
export function isCartPricesChangedResponse(body: unknown): boolean {
  return (
    (body as { details?: { reason?: unknown } } | null)?.details?.reason ===
    CART_PRICES_CHANGED_REASON
  );
}
