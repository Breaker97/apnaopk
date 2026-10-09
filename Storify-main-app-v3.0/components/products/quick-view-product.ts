"use client";

import { useEffect, useState } from "react";
import type { ModernProduct } from "@/lib/products/modern-product";

/**
 * The full product behind a card, for quick view.
 *
 * A card carries what a card shows (lib/products/storefront-product-cards.ts):
 * the colour swatches, the price and stock facts, the first picture. The
 * option picker's values, every variant's option values and the whole gallery
 * stay on the server until someone opens quick view — on the home page they
 * were two thirds of the page's data, sent to every visitor for a modal most
 * never open. This fetches them from the storefront product route (cached and
 * tag-invalidated like the product page) once per product per visit; the card
 * starts the fetch when the quick-view control is pointed at, touched or
 * focused, so it is usually back before the modal opens.
 */

const loaded = new Map<string, ModernProduct>();
const inflight = new Map<string, Promise<ModernProduct | null>>();

export function preloadQuickViewProduct(
  slug: string | undefined,
): Promise<ModernProduct | null> {
  if (!slug) return Promise.resolve(null);
  const done = loaded.get(slug);
  if (done) return Promise.resolve(done);

  let pending = inflight.get(slug);
  if (!pending) {
    pending = fetch(`/api/products/${encodeURIComponent(slug)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { success?: boolean; data?: ModernProduct } | null) => {
        const product = body?.success && body.data ? body.data : null;
        if (product) loaded.set(slug, product);
        return product;
      })
      .catch(() => null)
      .finally(() => inflight.delete(slug));
    inflight.set(slug, pending);
  }
  return pending;
}

/**
 * The card's product with the full one laid over it once it arrives.
 * `complete` is false until then — the picker waits for it, because a card's
 * variants carry no option values to match a selection against.
 */
export function useQuickViewProduct(card: ModernProduct | null): {
  product: ModernProduct | null;
  complete: boolean;
} {
  const slug = card?.slug;
  const [fetched, setFetched] = useState<{
    slug: string;
    product: ModernProduct;
  } | null>(null);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    void preloadQuickViewProduct(slug).then((product) => {
      if (active && product) setFetched({ slug, product });
    });
    return () => {
      active = false;
    };
  }, [slug]);

  const full = fetched && fetched.slug === slug ? fetched.product : null;
  return {
    product: card && full ? { ...card, ...full } : card,
    complete: Boolean(full),
  };
}
