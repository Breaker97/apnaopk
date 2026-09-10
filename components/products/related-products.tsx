import { type Locale } from "@/config/i18n.config";
import { type ModernProduct } from "./modern-product-card";
import { RelatedProductsCarousel } from "./related-products-carousel";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import type { RequestLocation } from "@/lib/locations/resolve-request-location";

const RELATED_PRODUCTS_LIMIT = 12;

interface RelatedProductsProps {
  productId: string;
  categoryId: string;
  locale: Locale;
  title: string;
  location?: RequestLocation;
  /** Header treatment, forwarded to the carousel. Presentation only. */
  appearance?: "classic" | "electronics";
}

async function fetchRelatedProducts(
  productId: string,
  categoryId: string,
  location: RequestLocation = {},
) {
  if (!categoryId) {
    return [];
  }

  const products = await getStorefrontProductCards({
    categoryIds: [categoryId],
    excludeIds: [productId],
    limit: RELATED_PRODUCTS_LIMIT,
    sortBy: "createdAt",
    sortOrder: "desc",
    ...location,
  });

  return products.slice(0, RELATED_PRODUCTS_LIMIT) as ModernProduct[];
}

export async function RelatedProducts({
  productId,
  categoryId,
  locale,
  title,
  location = {},
  appearance = "classic",
}: RelatedProductsProps) {
  const products = await fetchRelatedProducts(productId, categoryId, location);

  if (products.length === 0) {
    return null;
  }

  return (
    <RelatedProductsCarousel
      products={products}
      locale={locale}
      title={title}
      appearance={appearance}
    />
  );
}
