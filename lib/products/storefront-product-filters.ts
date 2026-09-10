import { unstable_cache } from "next/cache";
import mongoose from "mongoose";
import { PRODUCT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { expandCategoryIdsWithDescendants } from "@/lib/catalog/categories";
import { connectDB } from "@/lib/db";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { Brand, Category, Collection, Product, Vendor } from "@/models";

type StorefrontProductFilterOption = {
  name: string;
  slug: string;
};

/**
 * Actual price bounds of the products in scope, so the slider spans the data
 * instead of a hardcoded $0–1000. A vendor selling $5 accessories used to have
 * every product crammed into the leftmost half-percent of the track; one
 * selling $5,000 fridges had them all pinned to the max and unfilterable.
 *
 * `step` is derived from the span so dragging feels right at either scale.
 * `min === max` means the filter cannot narrow anything — callers hide the group
 * rather than render a dead control.
 */
export type StorefrontProductPriceRange = {
  min: number;
  max: number;
  step: number;
};

type StorefrontProductFilters = {
  categories: StorefrontProductFilterOption[];
  collections: StorefrontProductFilterOption[];
  priceRange: StorefrontProductPriceRange | null;
  /**
   * Ids of the categories actually represented in scope. Slugs drive the filter
   * checkboxes; the ids let a caller query comparable products elsewhere without
   * a second round trip to resolve them.
   */
  categoryIds: string[];
};

type StorefrontProductFilterQuery = {
  vendor?: string | null;
};

function mapCategory(category: { name: string; slug: string }) {
  return {
    name: category.name,
    slug: category.slug,
  };
}

function mapCollection(collection: { title: string; slug: string }) {
  return {
    name: collection.title,
    slug: collection.slug,
  };
}

function resolvePriceStep(span: number): number {
  if (span <= 100) return 1;
  if (span <= 1_000) return 10;
  if (span <= 10_000) return 100;
  return 1_000;
}

/**
 * Min/max across both product prices and variant prices — a product whose base
 * price sits outside its variants' range would otherwise be unreachable through
 * the slider, since the price filter itself matches either one.
 */
async function getPriceRange(
  productQuery: Record<string, unknown>,
): Promise<StorefrontProductPriceRange | null> {
  const [result] = await Product.aggregate<{ min: number; max: number }>([
    { $match: productQuery },
    {
      $project: {
        prices: {
          $filter: {
            input: {
              $concatArrays: [
                [{ $ifNull: ["$price", 0] }],
                { $ifNull: ["$variants.price", []] },
              ],
            },
            as: "price",
            cond: { $gt: ["$$price", 0] },
          },
        },
      },
    },
    { $unwind: "$prices" },
    {
      $group: { _id: null, min: { $min: "$prices" }, max: { $max: "$prices" } },
    },
  ]);

  if (
    !result ||
    typeof result.min !== "number" ||
    typeof result.max !== "number" ||
    !Number.isFinite(result.min) ||
    !Number.isFinite(result.max)
  ) {
    return null;
  }

  const step = resolvePriceStep(Math.max(0, result.max - result.min));
  const min = Math.max(0, Math.floor(result.min / step) * step);
  const max = Math.ceil(result.max / step) * step;

  return { min, max: Math.max(min, max), step };
}

export const getStorefrontProductFilters = unstable_cache(
  async (
    query: StorefrontProductFilterQuery = {},
  ): Promise<StorefrontProductFilters> => {
    await connectDB();

    const vendor = typeof query.vendor === "string" ? query.vendor.trim() : "";

    if (vendor) {
      const vendorDoc = await Vendor.findOne({
        ...(vendor.match(/^[0-9a-fA-F]{24}$/)
          ? { _id: vendor }
          : { slug: vendor.toLowerCase() }),
        status: VENDOR_STATUS.APPROVED,
        storeActive: { $ne: false },
      })
        .select("_id")
        .lean();

      if (!vendorDoc) {
        return {
          categories: [],
          collections: [],
          priceRange: null,
          categoryIds: [],
        };
      }

      const productQuery = {
        status: PRODUCT_STATUS.ACTIVE,
        ...(await getStorefrontProductConstraint()),
        vendorId: vendorDoc._id,
      };

      const [categoryIds, collectionIds, priceRange] = await Promise.all([
        Product.distinct("category", productQuery),
        Product.distinct("collectionIds", {
          ...productQuery,
          collectionIds: { $exists: true, $ne: [] },
        }),
        getPriceRange(productQuery),
      ]);

      const [dbCategories, dbCollections] = await Promise.all([
        categoryIds.length
          ? Category.find({ _id: { $in: categoryIds }, isActive: true })
              .sort({ order: 1, name: 1 })
              .select("name slug")
              .lean()
          : [],
        collectionIds.length
          ? Collection.find({ _id: { $in: collectionIds }, status: "active" })
              .sort({ position: 1, title: 1 })
              .select("title slug")
              .lean()
          : [],
      ]);

      return {
        categories: dbCategories.map(mapCategory),
        collections: dbCollections.map(mapCollection),
        priceRange,
        categoryIds: dbCategories.map((category) => String(category._id)),
      };
    }

    const [dbCategories, dbCollections, priceRange] = await Promise.all([
      Category.find({ isActive: true })
        .sort({ order: 1, name: 1 })
        .select("name slug")
        .lean(),
      Collection.find({ status: "active" })
        .sort({ position: 1, title: 1 })
        .select("title slug")
        .lean(),
      getPriceRange({
        status: PRODUCT_STATUS.ACTIVE,
        ...(await getStorefrontProductConstraint()),
      }),
    ]);

    return {
      categories: dbCategories.map(mapCategory),
      collections: dbCollections.map(mapCollection),
      priceRange,
      categoryIds: dbCategories.map((category) => String(category._id)),
    };
  },
  ["storefront-product-filters"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.categories, CACHE_TAGS.collections, CACHE_TAGS.products],
  },
);

type StorefrontCategoryFacets = {
  priceRange: StorefrontProductPriceRange | null;
  brands: StorefrontProductFilterOption[];
};

/**
 * Facets scoped to one category's whole branch — the price bounds and brand
 * list a category listing filters within. Separate from
 * `getStorefrontProductFilters` because a category page needs neither the
 * global category nor collection lists, and the global price span would hand
 * a $5-accessories category a slider calibrated for $5,000 fridges.
 */
export const getStorefrontCategoryFacets = unstable_cache(
  async (categorySlug: string): Promise<StorefrontCategoryFacets> => {
    await connectDB();

    const category = await Category.findOne({
      slug: categorySlug,
      isActive: true,
    })
      .select("_id")
      .lean();
    if (!category) return { priceRange: null, brands: [] };

    // Products sit on the leaves, so the branch — not the category alone —
    // is the scope. Same expansion the product query itself applies.
    const branchIds = await expandCategoryIdsWithDescendants([
      String(category._id),
    ]);
    const productQuery = {
      status: PRODUCT_STATUS.ACTIVE,
      ...(await getStorefrontProductConstraint()),
      category: {
        $in: branchIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    };

    const [priceRange, brandIds] = await Promise.all([
      getPriceRange(productQuery),
      Product.distinct("brand", { ...productQuery, brand: { $ne: null } }),
    ]);
    const dbBrands = brandIds.length
      ? await Brand.find({ _id: { $in: brandIds }, ...STOREFRONT_BRAND_FILTER })
          .sort({ name: 1 })
          .select("name slug")
          .lean<{ name: string; slug: string }[]>()
      : [];

    return {
      priceRange,
      brands: dbBrands.map((brand) => ({
        name: brand.name,
        slug: brand.slug,
      })),
    };
  },
  ["storefront-category-facets"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.categories, CACHE_TAGS.brands, CACHE_TAGS.products],
  },
);

/**
 * The storefront's global brand facet: approved brands that at least one
 * in-scope active product actually wears. Sits beside the category-scoped
 * variant above so the two listings offer brands the same way; the products
 * page has no branch to narrow by, so its scope is the whole catalogue.
 */
export const getStorefrontProductBrands = unstable_cache(
  async (): Promise<StorefrontProductFilterOption[]> => {
    await connectDB();

    const brandIds = await Product.distinct("brand", {
      status: PRODUCT_STATUS.ACTIVE,
      ...(await getStorefrontProductConstraint()),
      brand: { $ne: null },
    });
    if (brandIds.length === 0) return [];

    const brands = await Brand.find({
      _id: { $in: brandIds },
      ...STOREFRONT_BRAND_FILTER,
    })
      .sort({ name: 1 })
      .select("name slug")
      .lean<{ name: string; slug: string }[]>();

    return brands.map((brand) => ({ name: brand.name, slug: brand.slug }));
  },
  ["storefront-product-brands"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.brands, CACHE_TAGS.products],
  },
);
