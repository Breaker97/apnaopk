import { type Locale } from "@/config/i18n.config";
import { type ModernProduct } from "@/components/products/modern-product-card";
import { RelatedProductsCarousel } from "@/components/products/related-products-carousel";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import type { RequestLocation } from "@/lib/locations/resolve-request-location";

const SIMILAR_PRODUCTS_LIMIT = 12;

interface VendorSimilarProductsProps {
  /** Excluded from results — the store's own grid is directly above this row. */
  vendorId: string;
  /** Categories this store actually sells in. */
  categoryIds: string[];
  locale: Locale;
  title: string;
  /** Keep the cross-store strip inside the shopper's active area. */
  location?: RequestLocation;
}

/**
 * Comparable products from other stores, shown below a vendor's grid.
 *
 * A small store leaves most of a four-column row empty, which reads as a broken
 * page rather than as a small store. The product count above sets the
 * expectation; this row gives the fold something to be.
 *
 * Renders nothing when there is nothing to suggest — an empty carousel with a
 * heading is worse than no section.
 */
export async function VendorSimilarProducts({
  vendorId,
  categoryIds,
  locale,
  title,
  location = {},
}: VendorSimilarProductsProps) {
  if (categoryIds.length === 0) return null;

  const products = (await getStorefrontProductCards({
    categoryIds,
    excludeVendorId: vendorId,
    limit: SIMILAR_PRODUCTS_LIMIT,
    sortBy: "rating",
    sortOrder: "desc",
    ...location,
  })) as ModernProduct[];

  if (products.length === 0) return null;

  return (
    <div className="mt-10 border-t pt-8">
      <RelatedProductsCarousel
        products={products}
        locale={locale}
        title={title}
      />
    </div>
  );
}
