/**
 * The admin's category sources — Featured, Top-level, Hand-picked — read
 * against one store's categories, so a vendor's Category List and Category
 * Mosaic choose exactly as the marketplace's do, among what the store sells.
 *
 * Client-safe: the storefront sections, the builder's category endpoint and
 * the page write gate all read it.
 */

export type VendorCategorySource = "featured" | "topLevel" | "manual";

export interface VendorPoolCategory {
  id: string;
  name: string;
  slug: string;
  image?: string;
  featured: boolean;
  parentId: string | null;
  order: number;
}

/**
 * Every category a vendor's row may show: the categories its products are
 * in and the top-level categories those sit under, once each, in the
 * marketplace's category order — the order the admin's rows read in.
 */
export function vendorCategoryPool<T extends VendorPoolCategory>(taxonomy: {
  categories: T[];
  topLevel: T[];
}): T[] {
  const byId = new Map<string, T>();
  for (const category of [...taxonomy.topLevel, ...taxonomy.categories]) {
    if (!byId.has(category.id)) byId.set(category.id, category);
  }
  return [...byId.values()].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name),
  );
}

/**
 * The admin's selection rules over the store's pool:
 * - Hand-picked: the picks the store sells in, in pick order (no limit, as
 *   the admin's).
 * - Top-level: the top-level categories, up to the limit.
 * - Featured: the marketplace-featured ones, up to the limit; the Category
 *   List falls back to Top-level when none are featured (`featuredFallback`),
 *   the Category Mosaic does not — again as the admin's.
 */
export function pickVendorCategories<T extends VendorPoolCategory>(
  pool: T[],
  source: VendorCategorySource,
  limit: number,
  categoryIds: readonly string[],
  options: { featuredFallback?: boolean } = {},
): T[] {
  if (source === "manual") {
    const byId = new Map(pool.map((category) => [category.id, category]));
    return Array.from(new Set(categoryIds))
      .map((id) => byId.get(id))
      .filter((category): category is T => Boolean(category));
  }
  const count = Math.max(1, Math.floor(limit) || 1);
  const topLevel = pool.filter((category) => !category.parentId);
  if (source === "topLevel") return topLevel.slice(0, count);
  const featured = pool.filter((category) => category.featured);
  if (featured.length === 0 && options.featuredFallback) {
    return topLevel.slice(0, count);
  }
  return featured.slice(0, count);
}
