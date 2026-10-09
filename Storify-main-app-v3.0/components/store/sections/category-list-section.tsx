import { type Locale } from "@/config/i18n.config";
import { fetchFeaturedCategories } from "@/lib/storefront/section-data/categories";
import { CategoryTilesLazy as CategoryTiles } from "@/components/store/sections/category-tiles-lazy";
import { type FeaturedCategoriesSource } from "@/lib/site-config/home-page-config";
import type { CategoryListStyle } from "@/lib/storefront/sections/category-list-style";
import {
  pickVendorCategories,
  vendorCategoryPool,
} from "@/lib/vendors/vendor-category-source";
import { getVendorStoreTaxonomy } from "@/lib/vendors/vendor-store-taxonomy";

async function vendorCategories(
  vendorId: string,
  source: FeaturedCategoriesSource,
  limit: number,
  categoryIds: string[],
) {
  const taxonomy = await getVendorStoreTaxonomy(vendorId).catch(() => null);
  if (!taxonomy) return [];
  return pickVendorCategories(vendorCategoryPool(taxonomy), source, limit, categoryIds, {
    featuredFallback: true,
  }).map(({ id, name, slug, image }) => ({ id, name, slug, image }));
}

/**
 * The Category List block on the storefront: the cached category query,
 * then the tiles drawn from the block's style (its template's preset plus
 * whatever the merchant adjusted). Every template renders through here.
 */
export async function CategoryListSection({
  locale,
  title,
  source,
  limit,
  categoryIds,
  style,
  emptyState = null,
  vendor,
}: {
  locale: Locale;
  title: string;
  source: FeaturedCategoriesSource;
  limit: number;
  categoryIds: string[];
  style: CategoryListStyle;
  /** Labelled outline for the admin preview; null on the live storefront. */
  emptyState?: React.ReactNode;
  /**
   * A vendor's landing page: the same sources as the marketplace's row, read
   * among the categories that store sells in, each tile opening its own
   * Products tab.
   */
  vendor?: { id: string; slug: string };
}) {
  const categories = vendor
    ? await vendorCategories(vendor.id, source, limit, categoryIds)
    : await fetchFeaturedCategories(source, limit, categoryIds);
  // Live storefronts stay silent; the admin preview names what is missing.
  if (categories.length === 0) return emptyState;

  return (
    // No title: no top padding, so a Heading block above sits flush.
    <section className={title ? "py-5 lg:py-8" : "pb-5 lg:pb-8"}>
      <div className="container mx-auto px-4">
        <CategoryTiles
          locale={locale}
          categories={categories}
          style={style}
          title={title}
          vendorSlug={vendor?.slug}
        />
      </div>
    </section>
  );
}
