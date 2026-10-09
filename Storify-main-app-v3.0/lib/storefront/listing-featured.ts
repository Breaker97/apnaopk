import "server-only";

import type { ModernProduct } from "@/components/products/modern-product-card";
import { getStorefrontProducts } from "@/lib/products/storefront-products";

/** Featured minis the listing rail shows below its facets. */
const LISTING_FEATURED_LIMIT = 4;

/**
 * The featured strip under a listing's filter rail: the store's featured
 * products, or a category branch's when the listing is one department.
 * The strip must never take the page down with it, so a failed read is an
 * empty strip.
 */
export async function fetchListingFeaturedProducts(
  categorySlug?: string,
): Promise<ModernProduct[]> {
  try {
    const result = await getStorefrontProducts<ModernProduct>({
      ...(categorySlug ? { category: categorySlug } : null),
      featured: true,
      limit: LISTING_FEATURED_LIMIT,
      cardFieldsOnly: true,
    });
    return Array.isArray(result.data) ? result.data : [];
  } catch {
    return [];
  }
}
