import "server-only";

import { unstable_cache } from "next/cache";
import { PRODUCT_STATUS } from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { connectDB, mongoose } from "@/lib/db";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { Brand, Category, Collection, Product } from "@/models";

export interface VendorStoreCategory {
  id: string;
  name: string;
  slug: string;
  image?: string;
  /**
   * This vendor's products in it — for a top-level category, in it and in
   * every category under it.
   */
  productCount: number;
  /** The marketplace's own flags, so a vendor's row picks as the admin's does. */
  featured: boolean;
  parentId: string | null;
  /** The marketplace's category order. */
  order: number;
}

const CATEGORY_FIELDS = "name slug image order featured parentId";

interface LeanCategory {
  _id: unknown;
  name: string;
  slug: string;
  image?: string;
  order?: number;
  featured?: boolean;
  parentId?: unknown;
}

function toStoreCategory(category: LeanCategory, productCount: number): VendorStoreCategory {
  return {
    id: String(category._id),
    name: category.name,
    slug: category.slug,
    ...(category.image ? { image: category.image } : {}),
    productCount,
    featured: category.featured === true,
    parentId: category.parentId ? String(category.parentId) : null,
    order: category.order ?? 0,
  };
}

/** Deep enough for any real tree; a cycle in bad data stops here too. */
const MAX_CATEGORY_DEPTH = 6;

/**
 * The top-level categories the vendor sells under — a vendor whose products
 * all sit in "Laptops" sells under "Computers" — each counting the vendor's
 * products anywhere below it. An inactive ancestor ends the climb, so the
 * highest active category stands in as the root, as the storefront shows it.
 */
async function topLevelCategories(
  categories: LeanCategory[],
  counts: Map<string, number>,
): Promise<VendorStoreCategory[]> {
  const byId = new Map(categories.map((category) => [String(category._id), category]));
  let missing = new Set(
    categories
      .map((category) => (category.parentId ? String(category.parentId) : ""))
      .filter((id) => id && !byId.has(id)),
  );
  for (let depth = 0; depth < MAX_CATEGORY_DEPTH && missing.size > 0; depth += 1) {
    const parents = await Category.find({ _id: { $in: [...missing] }, isActive: true })
      .select(CATEGORY_FIELDS)
      .lean<LeanCategory[]>();
    for (const parent of parents) byId.set(String(parent._id), parent);
    missing = new Set(
      parents
        .map((parent) => (parent.parentId ? String(parent.parentId) : ""))
        .filter((id) => id && !byId.has(id)),
    );
  }

  const rootOf = (category: LeanCategory): LeanCategory => {
    let current = category;
    for (let depth = 0; depth < MAX_CATEGORY_DEPTH; depth += 1) {
      const parent = current.parentId ? byId.get(String(current.parentId)) : undefined;
      if (!parent) return current;
      current = parent;
    }
    return current;
  };

  const roots = new Map<string, { category: LeanCategory; count: number }>();
  for (const category of categories) {
    const root = rootOf(category);
    const key = String(root._id);
    const entry = roots.get(key) ?? { category: root, count: 0 };
    entry.count += counts.get(String(category._id)) ?? 0;
    roots.set(key, entry);
  }
  return [...roots.values()]
    // A root is top-level here even when an inactive parent hid the rest.
    .map(({ category, count }) => ({ ...toStoreCategory(category, count), parentId: null }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export interface VendorStoreCollection {
  id: string;
  title: string;
  slug: string;
  image?: { url?: string; alt?: string };
  /** This vendor's products in it. */
  productCount: number;
  /** A Look (a styled outfit) rather than a plain collection. */
  kind: "collection" | "look";
}

export interface VendorStoreBrand {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  /** This vendor's products of it. */
  productCount: number;
}

export interface VendorStoreTaxonomy {
  /** The categories the vendor's products are in, busiest first. */
  categories: VendorStoreCategory[];
  /** The top-level categories those sit under, in the marketplace's order. */
  topLevel: VendorStoreCategory[];
  collections: VendorStoreCollection[];
  brands: VendorStoreBrand[];
}

const EMPTY: VendorStoreTaxonomy = {
  categories: [],
  topLevel: [],
  collections: [],
  brands: [],
};

/**
 * The categories, collections and brands a vendor actually sells in — those
 * holding at least one of the vendor's products the storefront shows —
 * busiest first. What a vendor's landing page offers as tiles: each one
 * opens the store's own Products tab filtered to it, never the
 * marketplace-wide page.
 *
 * Cached per vendor on the catalogue tags, like the storefront's own filter
 * lists.
 */
export async function getVendorStoreTaxonomy(
  vendorId: string,
): Promise<VendorStoreTaxonomy> {
  if (!mongoose.isValidObjectId(vendorId)) return EMPTY;
  return unstable_cache(
    async (): Promise<VendorStoreTaxonomy> => {
      await connectDB();
      const constraint = await getStorefrontProductConstraint();
      const existingVendorFilter =
        typeof constraint.vendorId === "object" && constraint.vendorId !== null
          ? (constraint.vendorId as Record<string, unknown>)
          : {};
      // Narrows the approved-vendor filter rather than replacing it, so a
      // paused store's products never surface here either.
      const match = {
        status: PRODUCT_STATUS.ACTIVE,
        ...constraint,
        vendorId: {
          ...existingVendorFilter,
          $eq: new mongoose.Types.ObjectId(vendorId),
        },
      };

      const [categoryCounts, collectionCounts, brandCounts] = await Promise.all([
        Product.aggregate<{ _id: unknown; count: number }>([
          { $match: match },
          { $group: { _id: "$category", count: { $sum: 1 } } },
        ]),
        Product.aggregate<{ _id: unknown; count: number }>([
          { $match: match },
          { $unwind: "$collectionIds" },
          { $group: { _id: "$collectionIds", count: { $sum: 1 } } },
        ]),
        Product.aggregate<{ _id: unknown; count: number }>([
          { $match: { ...match, brand: { $ne: null } } },
          { $group: { _id: "$brand", count: { $sum: 1 } } },
        ]),
      ]);

      const countOf = (rows: { _id: unknown; count: number }[]) =>
        new Map(
          rows
            .filter((row) => row._id)
            .map((row) => [String(row._id), row.count]),
        );
      const categoryCount = countOf(categoryCounts);
      const collectionCount = countOf(collectionCounts);
      const brandCount = countOf(brandCounts);

      const [categories, collections, brands] = await Promise.all([
        categoryCount.size > 0
          ? Category.find({ _id: { $in: [...categoryCount.keys()] }, isActive: true })
              .select(CATEGORY_FIELDS)
              .lean<LeanCategory[]>()
          : [],
        collectionCount.size > 0
          ? Collection.find({ _id: { $in: [...collectionCount.keys()] }, status: "active" })
              .select("title slug image position kind")
              .lean<{
                _id: unknown;
                title: string;
                slug: string;
                image?: { url?: string; alt?: string };
                position?: number;
                kind?: string;
              }[]>()
          : [],
        // The brands the public storefront shows: one awaiting review or
        // switched off never becomes a tile.
        brandCount.size > 0
          ? Brand.find({ _id: { $in: [...brandCount.keys()] }, ...STOREFRONT_BRAND_FILTER })
              .select("name slug logo")
              .lean<{ _id: unknown; name: string; slug: string; logo?: string }[]>()
          : [],
      ]);

      const topLevel = await topLevelCategories(categories, categoryCount);

      return {
        categories: categories
          .map((category) =>
            toStoreCategory(category, categoryCount.get(String(category._id)) ?? 0),
          )
          .sort((a, b) => b.productCount - a.productCount || a.order - b.order || a.name.localeCompare(b.name)),
        topLevel,
        collections: collections
          .map((collection) => ({
            id: String(collection._id),
            title: collection.title,
            slug: collection.slug,
            ...(collection.image?.url ? { image: collection.image } : {}),
            productCount: collectionCount.get(String(collection._id)) ?? 0,
            kind: collection.kind === "look" ? ("look" as const) : ("collection" as const),
            position: collection.position ?? 0,
          }))
          .sort((a, b) => b.productCount - a.productCount || a.position - b.position || a.title.localeCompare(b.title))
          .map(({ position: _position, ...collection }) => collection),
        brands: brands
          .map((brand) => ({
            id: String(brand._id),
            name: brand.name,
            slug: brand.slug,
            ...(brand.logo ? { logo: brand.logo } : {}),
            productCount: brandCount.get(String(brand._id)) ?? 0,
          }))
          .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name)),
      };
    },
    // v3: the categories' marketplace flags and the top-level roots joined
    // the shape; a new key keeps an older cached entry from being read as it.
    ["vendor-store-taxonomy-v3", vendorId],
    {
      tags: [
        CACHE_TAGS.products,
        CACHE_TAGS.categories,
        CACHE_TAGS.collections,
        CACHE_TAGS.brands,
      ],
      revalidate: 300,
    },
  )();
}
