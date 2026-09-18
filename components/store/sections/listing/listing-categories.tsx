import Link from "next/link";
import { type Locale } from "@/config/i18n.config";
import { fetchFeaturedCategories } from "@/components/store/home-featured-categories";
import { CategoryTiles } from "@/components/store/sections/category-tiles";
import {
  listingActiveCategory,
  listingCategoryHref,
  listingCategoryTileStyle,
} from "@/lib/storefront/sections/products-listing-layout";
import type { ProductsListingLayout } from "@/lib/storefront/sections/products-listing-layout";
import type { ListingCategoryContext } from "@/lib/storefront/listing-category";
import { cn } from "@/lib/utils";

/**
 * The listing's categories, in whichever of the category block's designs
 * the merchant picked — the block's own renderer with the design's preset,
 * and the same cached query as the home page's category section, so a
 * department reads alike on both pages. Every design filters THIS listing
 * rather than leaving for the department's page.
 *
 * Opened on a category, the row is that category's (`row`): its
 * sub-departments, or — for a leaf — the departments beside it, with the
 * leading chip naming the department they belong to instead of "All".
 */
export async function ListingCategories({
  locale,
  layout,
  searchParams,
  allLabel,
  row,
  className,
}: {
  locale: Locale;
  layout: ProductsListingLayout;
  searchParams: Record<string, string | string[] | undefined>;
  /** The chip row's leading "All" chip. */
  allLabel: string;
  /** The opened category's own row, when the listing is on one. */
  row?: ListingCategoryContext["row"];
  className?: string;
}) {
  if (layout.categoryStyle === "hidden") return null;
  const categories = row
    ? row.categories.map((category) => ({
        id: category._id,
        name: category.name,
        slug: category.slug,
        image: category.image,
      }))
    : await fetchFeaturedCategories(
        layout.categorySource,
        layout.categoryLimit,
        layout.categoryIds,
      );
  if (categories.length === 0) return null;

  const active = row ? row.active : listingActiveCategory(searchParams);

  switch (layout.categoryStyle) {
    case "chips": {
      const basePath = `/${locale}/products`;
      const chips = [
        row
          ? {
              key: "__all",
              label: row.heading.name,
              href: listingCategoryHref(basePath, searchParams, row.heading.slug),
              current: active === null,
            }
          : { key: "__all", label: allLabel, href: listingCategoryHref(basePath, searchParams, null), current: active === null },
        ...categories.map((category) => ({
          key: category.id,
          label: category.name,
          href: listingCategoryHref(basePath, searchParams, category.slug),
          current: active === category.slug,
        })),
      ];
      return (
        <nav
          aria-label={allLabel}
          className={cn(
            "flex min-w-0 gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            layout.categoryAlign === "center" && "justify-center-safe",
            className,
          )}
        >
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              scroll={false}
              aria-current={chip.current ? "page" : undefined}
              className={cn(
                "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-button px-4 text-sm font-medium transition-colors",
                chip.current
                  ? "bg-foreground text-background"
                  : "text-foreground/70 hover:bg-muted hover:text-foreground",
              )}
            >
              {chip.label}
            </Link>
          ))}
        </nav>
      );
    }
    case "circles":
    case "cards":
    case "overlay":
      return (
        <CategoryTiles
          locale={locale}
          categories={categories}
          style={listingCategoryTileStyle(layout.categoryStyle, layout)}
          activeSlug={active}
          linkTo="listing"
          className={className}
        />
      );
  }
}
