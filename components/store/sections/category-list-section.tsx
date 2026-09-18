import { type Locale } from "@/config/i18n.config";
import { fetchFeaturedCategories } from "@/components/store/home-featured-categories";
import { CategoryTiles } from "@/components/store/sections/category-tiles";
import { type FeaturedCategoriesSource } from "@/lib/site-config/home-page-config";
import type { CategoryListStyle } from "@/lib/storefront/sections/category-list-style";

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
}: {
  locale: Locale;
  title: string;
  source: FeaturedCategoriesSource;
  limit: number;
  categoryIds: string[];
  style: CategoryListStyle;
  /** Labelled outline for the admin preview; null on the live storefront. */
  emptyState?: React.ReactNode;
}) {
  const categories = await fetchFeaturedCategories(source, limit, categoryIds);
  // Live storefronts stay silent; the admin preview names what is missing.
  if (categories.length === 0) return emptyState;

  return (
    // No title: no top padding, so a Heading block above sits flush.
    <section className={title ? "py-5 lg:py-8" : "pb-5 lg:pb-8"}>
      <div className="container mx-auto px-4">
        <CategoryTiles locale={locale} categories={categories} style={style} title={title} />
      </div>
    </section>
  );
}
