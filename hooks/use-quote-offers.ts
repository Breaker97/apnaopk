"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";

/**
 * The prices this shopper — and only this shopper — may buy a quoted product
 * at, fetched from the browser.
 *
 * Never resolved while rendering the product page: storefront pages are cached
 * and handed to every visitor, so a negotiated price baked into that HTML
 * would be shown to whoever else lands on the same cache entry. Fetching it
 * here keeps the cached page user-neutral and the price where it belongs.
 *
 * One request, on mount. A quote arriving while the page is open reaches the
 * shopper by email and in their account; polling every product page a signed-in
 * visitor opens, on the chance a merchant is quoting them at that moment,
 * would cost far more than it is worth.
 */

export interface ShopperQuoteOffer {
  quoteId: string;
  productId: string;
  variantId?: string;
  productName: string;
  variantName?: string;
  unitPrice: number;
  /** The exact quantity the price covers; any other quantity is not quoted. */
  quantity: number;
  note?: string;
  expiresAt?: string;
}

export function useQuoteOffers(
  productId: string,
  enabled: boolean,
): ShopperQuoteOffer[] {
  /**
   * The answer is stored WITH the product it answers, and read back only when
   * the two still agree. That is what makes "no offers" a derived value rather
   * than something an effect has to go and clear — clearing it there would put
   * a setState in the effect body and cascade a render on every product page.
   */
  const [result, setResult] = useState<{
    productId: string;
    offers: ShopperQuoteOffer[];
  } | null>(null);

  useEffect(() => {
    if (!enabled || !productId) return;
    const controller = new AbortController();
    apiClient
      .get<ShopperQuoteOffer[]>(
        `/api/quotes/offers?productId=${encodeURIComponent(productId)}`,
        { signal: controller.signal },
      )
      .then((offers) => {
        if (controller.signal.aborted) return;
        setResult({
          productId,
          offers: Array.isArray(offers) ? offers : [],
        });
      })
      .catch(() => {
        // A shopper with no quote is the normal case and reads as an empty
        // list; a failure here must never take the buy box down with it.
      });
    return () => controller.abort();
  }, [productId, enabled]);

  return enabled && result?.productId === productId ? result.offers : EMPTY;
}

/** Stable identity, so a consumer memoising on the result does not thrash. */
const EMPTY: ShopperQuoteOffer[] = [];
