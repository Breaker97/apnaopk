import "server-only";

import {
  getStorefrontCategoryAncestors,
  getStorefrontCategoryBySlug,
  type StorefrontCategory,
  type StorefrontCategoryCrumb,
} from "@/lib/storefront/storefront-categories";
import { listingActiveCategory } from "@/lib/storefront/sections/products-listing-layout";

/**
 * The products listing, opened on ONE category: the page then reads as that
 * category's — its name for the title, its trail in the breadcrumb, its
 * sub-departments in the category row — rather than as "All Products" with
 * a filter ticked. Several categories ticked in the facets is a filter,
 * not a place, and resolves to nothing here.
 */
export interface ListingCategoryContext {
  category: StorefrontCategory;
  /** Root first, the category itself excluded. */
  ancestors: StorefrontCategoryCrumb[];
  /**
   * What the category row shows: the category's own children when it has
   * any; else, for a leaf under a parent, that parent's children with this
   * one marked. A top-level leaf has neither and keeps the merchant's row.
   */
  row: { heading: StorefrontCategoryCrumb; categories: StorefrontCategory[]; active: string | null } | null;
}

export async function resolveListingCategory(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<ListingCategoryContext | null> {
  const slug = listingActiveCategory(searchParams);
  if (!slug) return null;
  const [category, ancestors] = await Promise.all([
    getStorefrontCategoryBySlug(slug),
    getStorefrontCategoryAncestors(slug),
  ]);
  if (!category) return null;

  let row: ListingCategoryContext["row"] = null;
  if (category.children.length > 0) {
    row = {
      heading: { _id: category._id, name: category.name, slug: category.slug },
      categories: category.children,
      active: null,
    };
  } else {
    const parent = ancestors[ancestors.length - 1];
    const siblings = parent ? await getStorefrontCategoryBySlug(parent.slug) : null;
    if (parent && siblings && siblings.children.length > 0) {
      row = { heading: parent, categories: siblings.children, active: category.slug };
    }
  }
  return { category, ancestors, row };
}

/** A crumb per step of the trail, each a link back to that category's listing. */
export function listingCategoryTrail(
  context: ListingCategoryContext,
  options: { searchQuery?: string } = {},
): { label: string; href?: string }[] {
  const href = (slug: string) => `/products?category=${encodeURIComponent(slug)}`;
  const trail: { label: string; href?: string }[] = context.ancestors.map((crumb) => ({
    label: crumb.name,
    href: href(crumb.slug),
  }));
  // With a search on top, the category is one more link and the search is
  // where the shopper is.
  trail.push(
    options.searchQuery
      ? { label: context.category.name, href: href(context.category.slug) }
      : { label: context.category.name },
  );
  return trail;
}
