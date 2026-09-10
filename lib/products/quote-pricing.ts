/**
 * Single source of truth for "is this product sold by quote rather than by
 * price?".
 *
 * A merchant turns **Price on request** on in the product form's Pricing card
 * when the number is not something a shopper may simply read and pay —
 * made-to-order furniture, bulk B2B lots, machinery, anything negotiated. The
 * product keeps its `price` field (0 for one that never had a number) so every
 * aggregation, index and sort in the catalogue keeps working untouched; what
 * changes is what the shopper is shown and allowed to do:
 *
 *   - every price on every surface (card, quick view, product page, sticky
 *     bars, structured data) is replaced by "Price on request";
 *   - Add to cart / Buy now is replaced by a "Request a quote" button;
 *   - the cart API refuses the line, so a stale tab, a bookmarked POST or a
 *     card rendered before the switch was flipped cannot buy it anyway.
 *
 * Both halves read the helpers here rather than the raw flag, so the buy box
 * and the server guard can never disagree — the same reason
 * lib/products/stock-policy.ts exists for stock.
 */

export type QuotePricingSource = {
  priceOnRequest?: boolean | null;
  quoteButtonLabel?: string | null;
};

/** True when the shopper must ask for a price instead of paying one. */
export function isQuoteOnlyProduct(
  product: QuotePricingSource | null | undefined,
): boolean {
  return product?.priceOnRequest === true;
}

/**
 * The merchant's own wording for the quote button, when they set one.
 * `fallback` is the translated default ("Request a quote") — passed in rather
 * than resolved here so this module stays usable on the server, where there is
 * no locale in scope.
 */
export function getQuoteButtonLabel(
  product: QuotePricingSource | null | undefined,
  fallback: string,
): string {
  const custom = product?.quoteButtonLabel?.trim();
  return custom || fallback;
}
