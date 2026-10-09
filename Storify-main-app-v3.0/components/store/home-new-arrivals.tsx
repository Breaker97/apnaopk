import { type Locale } from "@/config/i18n.config";
import { HomeNewArrivalsCarouselLazy as HomeNewArrivalsCarousel } from "@/components/store/home-new-arrivals-carousel-lazy";
import { productSourceEmptyState } from "@/components/store/sections/product-source-empty-state";
import { type NewArrivalsSource } from "@/lib/site-config/home-page-config";
import {
  loadProductShelf,
  productShelfColumns,
} from "@/lib/storefront/section-data/product-shelves";
import { isProductTargetSource } from "@/lib/storefront/sections/product-source";

export async function HomeNewArrivals({
  locale,
  title,
  subtitle,
  source = "discounted",
  limit = 8,
  desktopColumns = 4,
  productIds = [],
  categoryId,
  brandId,
  collectionId,
  preview = false,
  vendor,
}: {
  locale: Locale;
  title?: string;
  subtitle?: string;
  source?: NewArrivalsSource;
  limit?: number;
  desktopColumns?: number;
  productIds?: string[];
  /** The picked category, brand or collection; only the source's own is read. */
  categoryId?: string;
  brandId?: string;
  collectionId?: string;
  /** The builder's preview: an empty picked source says why instead of vanishing. */
  preview?: boolean;
  /**
   * A vendor's landing page: the shelf lists that store's products alone,
   * and "View all" opens its own Products tab.
   */
  vendor?: { id: string; slug: string };
}) {
  const shelf = await loadProductShelf({
    source,
    limit,
    productIds,
    categoryId,
    brandId,
    collectionId,
    ...(vendor ? { vendor } : {}),
  });
  if (shelf.products.length === 0) {
    return isProductTargetSource(source) && shelf.missing
      ? productSourceEmptyState({ preview }, { locale, source, missing: shelf.missing })
      : null;
  }

  return (
    <HomeNewArrivalsCarousel
      locale={locale}
      products={shelf.products}
      title={title}
      subtitle={subtitle}
      desktopColumns={productShelfColumns(desktopColumns)}
      viewAllHref={`/${locale}${shelf.href}`}
    />
  );
}
