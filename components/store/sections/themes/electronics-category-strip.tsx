import { type Locale } from "@/config/i18n.config";
import { type FeaturedCategoriesSource } from "@/lib/site-config/home-page-config";
import { fetchFeaturedCategories } from "@/components/store/home-featured-categories";
import { ElectronicsCategoryScroller } from "./electronics-category-scroller";
import { ElectronicsSectionHeading } from "./electronics-section-heading";

/**
 * Electronics' category row: the design's circular tiles under a centred
 * two-tone heading, scrolling sideways rather than wrapping — the shape a
 * shopper reads as "departments" instead of "a grid of images".
 *
 * Reuses the base section's cached fetch, so switching themes changes the
 * arrangement without adding a query. The row itself is a client component
 * because the design puts scroll arrows on both ends.
 */
export async function ElectronicsCategoryStrip({
  locale,
  title,
  source,
  limit,
  categoryIds,
  emptyState = null,
}: {
  locale: Locale;
  title: string;
  source: FeaturedCategoriesSource;
  limit: number;
  categoryIds: string[];
  /** Labelled outline for the admin preview; null on the live storefront. */
  emptyState?: React.ReactNode;
}) {
  const categories = await fetchFeaturedCategories(source, limit, categoryIds);
  // Live storefronts stay silent; the admin preview names what is missing.
  if (categories.length === 0) return emptyState;

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <ElectronicsSectionHeading title={title} className="mb-6 lg:mb-[33px]" />
        <ElectronicsCategoryScroller
          locale={locale}
          categories={categories.map((category) => ({
            id: category.id,
            slug: category.slug,
            name: category.name,
            image: category.image,
          }))}
        />
      </div>
    </section>
  );
}
