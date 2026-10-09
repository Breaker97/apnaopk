import "server-only";

import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { type FeaturedCategoriesSource } from "@/lib/site-config/home-page-config";
import { withFallback } from "@/lib/storefront/cached-read";
import type { CategoryTile } from "@/lib/storefront/sections/category-list-style";
import { Category } from "@/models";
import {
  pickVendorCategories,
  vendorCategoryPool,
} from "@/lib/vendors/vendor-category-source";
import { getVendorStoreTaxonomy } from "@/lib/vendors/vendor-store-taxonomy";
import { vendorProductsPath } from "./product-source";
import { readOr, type SectionReadMode } from "./read-mode";

/**
 * The category rows of the home page: the Category List strip and the
 * Category Mosaic. A failed read throws from the `read…` readers; the
 * storefront's `fetch…` readers answer an empty row instead.
 */

const CATEGORY_SELECT = "_id name slug image order featured";

function toTile(category: {
  _id: unknown;
  name: string;
  slug: string;
  image?: string;
}): CategoryTile {
  return {
    id: String(category._id),
    name: category.name,
    slug: category.slug,
    image: category.image,
  };
}

/**
 * The Category List's categories: hand-picked (in the merchant's order),
 * the top level, or the featured ones — falling back to the top level so the
 * section is never empty.
 */
export const readFeaturedCategories = unstable_cache(
  async (
    source: FeaturedCategoriesSource,
    limit: number,
    categoryIds: string[],
  ): Promise<CategoryTile[]> => {
    await connectDB();

    if (source === "manual") {
      const ids = categoryIds.filter(Boolean);
      if (ids.length === 0) return [];

      const categories = await Category.find({
        isActive: true,
        _id: { $in: ids },
      })
        .select(CATEGORY_SELECT)
        .lean();

      // Preserve the admin-defined order.
      const order = new Map(ids.map((id, index) => [id, index]));
      return categories
        .map(toTile)
        .sort(
          (a, b) =>
            (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        );
    }

    if (source === "topLevel") {
      const categories = await Category.find({
        isActive: true,
        parentId: null,
      })
        .select(CATEGORY_SELECT)
        .sort({ order: 1, name: 1 })
        .limit(limit)
        .lean();
      return categories.map(toTile);
    }

    // source === "featured": flagged categories, falling back to top-level
    // ones so the section is never empty.
    let categories = await Category.find({
      isActive: true,
      featured: true,
    })
      .select(CATEGORY_SELECT)
      .sort({ order: 1, name: 1 })
      .limit(limit)
      .lean();

    if (categories.length === 0) {
      categories = await Category.find({
        isActive: true,
        parentId: null,
      })
        .select(CATEGORY_SELECT)
        .sort({ order: 1, name: 1 })
        .limit(limit)
        .lean();
    }

    return categories.map(toTile);
  },
  ["home-featured-categories"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.categories],
  },
);

export const fetchFeaturedCategories = withFallback(readFeaturedCategories, () => []);

export type MosaicSource = "featured" | "topLevel" | "manual";

export interface MosaicCategory {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  /** Where the tile goes; the category page when unset. */
  href?: string;
}

const MOSAIC_MIN = 3;
const MOSAIC_MAX = 7;

/** Same select and tags as the Category List's reader. */
const readMosaicCategories = unstable_cache(
  async (source: MosaicSource, ids: string[], limit: number) => {
    await connectDB();
    const select = "_id name slug image";
    if (source === "manual" && ids.length > 0) {
      const categories = await Category.find({
        _id: { $in: ids },
        isActive: true,
      })
        .select(select)
        .lean();
      const order = new Map(ids.map((id, index) => [id, index]));
      categories.sort(
        (a, b) =>
          (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0),
      );
      return JSON.parse(JSON.stringify(categories.slice(0, limit)));
    }

    const query: Record<string, unknown> = { isActive: true };
    // `parentId` — `parent` is the model's populate virtual, and filtering on
    // it silently matched every category, sub-categories included.
    if (source === "featured") query.featured = true;
    else query.parentId = null;
    const categories = await Category.find(query)
      .select(select)
      .sort({ order: 1, name: 1 })
      .limit(limit)
      .lean();
    return JSON.parse(JSON.stringify(categories));
  },
  ["section-category-mosaic"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.categories],
  },
);

const fetchMosaicCategories = withFallback(readMosaicCategories, () => []);

/**
 * The Category Mosaic's tiles: a lead tile and up to six beside it. Fewer
 * than three categories cannot make the bento, so the section shows nothing
 * (an empty list).
 */
export async function loadCategoryMosaic(
  options: {
    source: MosaicSource;
    limit: number;
    categoryIds: string[];
    /**
     * A vendor's landing page: the same sources, read among the categories
     * that store sells in (no fallback for Featured, as the marketplace's
     * mosaic), each tile opening its own Products tab filtered to it.
     */
    vendor?: { id: string; slug: string };
  },
  mode: SectionReadMode = "page",
): Promise<MosaicCategory[]> {
  const limit = Math.min(MOSAIC_MAX, Math.max(MOSAIC_MIN, options.limit));
  const { vendor } = options;
  if (vendor) {
    const taxonomy = await readOr(
      mode,
      () => getVendorStoreTaxonomy(vendor.id),
      () => null,
    );
    const categories = taxonomy
      ? pickVendorCategories(
          vendorCategoryPool(taxonomy),
          options.source,
          limit,
          options.categoryIds,
        )
          .slice(0, limit)
          .map((category) => ({
            _id: category.id,
            name: category.name,
            slug: category.slug,
            ...(category.image ? { image: category.image } : {}),
            href: vendorProductsPath(vendor.slug, { key: "category", slug: category.slug }),
          }))
      : [];
    return categories.length < MOSAIC_MIN ? [] : categories;
  }
  const read = mode === "strict" ? readMosaicCategories : fetchMosaicCategories;
  const categories = (await read(options.source, options.categoryIds, limit)) as MosaicCategory[];
  return categories.length < MOSAIC_MIN ? [] : categories;
}
