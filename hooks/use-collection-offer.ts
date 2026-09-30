"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";
import { hasLocationCoordinates } from "@/lib/locations/shopper-location";

/**
 * "Collect at <branch>" on the product page: the nearest branch that can hand
 * this product over, for the place the page's URL carries (`?lat=&lng=` and
 * `radius`, a listing's location filter), fetched from the browser.
 *
 * Never resolved while rendering the product page: the page is served from
 * the cache and handed to every visitor, so an answer for one shopper's place
 * would be shown to whoever lands on it next. The URL is read after hydration
 * for the same reason — `useSearchParams` in a cached page makes the server
 * render stop at the nearest Suspense boundary, which here is the whole buy
 * box.
 *
 * One request, on mount, and none without a point in the URL — which is every
 * visit that did not come through a location-filtered link.
 */

interface CollectionOffer {
  branchName: string;
  /** Variants the branch stocks; `null` when the product has none. */
  variantIds: string[] | null;
}

export function useCollectionOffer(slug: string): CollectionOffer | null {
  /**
   * Stored WITH the product it answers and read back only while the two still
   * agree, as in useQuoteOffers: moving to another product needs no effect to
   * clear the last one's answer.
   */
  const [result, setResult] = useState<{
    slug: string;
    offer: CollectionOffer | null;
  } | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const lat = search.get("lat");
    const lng = search.get("lng");
    if (!slug || !lat || !lng || !hasLocationCoordinates(lat, lng)) return;

    const query = new URLSearchParams({ lat, lng });
    const radius = search.get("radius");
    if (radius) query.set("radius", radius);

    const controller = new AbortController();
    apiClient
      .get<CollectionOffer | null>(
        `/api/products/${encodeURIComponent(slug)}/collection-offer?${query}`,
        { signal: controller.signal },
      )
      .then((offer) => {
        if (controller.signal.aborted) return;
        setResult({ slug, offer: offer ?? null });
      })
      .catch(() => {
        // No branch in reach is the everyday answer; a failure here must
        // never take the buy box down with it.
      });
    return () => controller.abort();
  }, [slug]);

  return result?.slug === slug ? result.offer : null;
}
