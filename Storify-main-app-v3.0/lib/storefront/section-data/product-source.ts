import "server-only";

import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import { expandCategoryIdsWithDescendants } from "@/lib/catalog/categories";
import { connectDB, mongoose } from "@/lib/db";
import type { ModernProduct } from "@/lib/products/modern-product";
import {
  getStorefrontProductCards,
  type StorefrontProductCardQuery,
} from "@/lib/products/storefront-product-cards";
import {
  isProductTargetSource,
  productSourceTarget,
} from "@/lib/storefront/sections/product-source";
import { Brand, Category } from "@/models";
import { vendorProductsPath } from "@/lib/vendors/vendor-store-page";
import { readCollectionSource } from "./collection-shelf";

/**
 * Where a product shelf's products come from: the one resolver behind the
 * product-grid carousel, the product-browser, every product-group tab (the
 * one sent with the page and the ones GET /api/product-cards answers) and the
 * shopper app's home blocks — so a shelf shows the same products wherever it
 * is read.
 *
 * A shelf's own sources (newest, featured, on sale, hand-picked) run the card
 * query that shelf has always run, handed in by the caller. A picked
 * category, brand or collection is read here:
 * - category: the category, if the storefront shows it, and every category
 *   below it at any depth — the same set the category page and
 *   /api/products show; newest first.
 * - brand: a brand the storefront shows (STOREFRONT_BRAND_FILTER); newest
 *   first.
 * - collection: the collection exactly as the Featured Collection rows and
 *   the collection page read it, in its own order.
 * All of them keep the card reader's guards — active products of approved,
 * live vendors published to the online store — and the card shelves keep the
 * out-of-stock display policy. A picked source never stands in for another:
 * nothing picked, a pick the storefront no longer shows, or a pick with no
 * products answers no products, and says which (`missing`).
 */

/** The sources every shelf had before picked categories, brands and collections. */
export type CuratedProductSource = "latest" | "featured" | "discounted" | "manual";

/** A shelf's source settings, as its section (or tab) stores them. */
export interface ProductSourceInput {
  source: string;
  productIds: string[];
  categoryId?: string;
  brandId?: string;
  collectionId?: string;
}

/**
 * Why a picked category, brand or collection gives the shelf nothing:
 * - "unpicked": none is chosen yet;
 * - "unavailable": the pick was deleted, switched off, or is not shown on
 *   the storefront (a draft or unpublished collection, a brand awaiting
 *   approval);
 * - "empty": the pick is shown, but none of its products are.
 */
export type ProductSourceMissing = "unpicked" | "unavailable" | "empty";

export interface ProductSelection {
  products: ModernProduct[];
  /**
   * Where "View all" leads for a picked category, brand or collection — a
   * storefront path without the locale. Absent for the shelf's own sources.
   */
  href?: string;
  /** Set when a picked source has nothing to show, and why. */
  missing?: ProductSourceMissing;
}

/** Newest first: the order the picked category and brand shelves use. */
const NEWEST_FIRST = { sortBy: "createdAt", sortOrder: "desc" } as const;

/**
 * A category the storefront shows, with its whole branch: the ids of the
 * category and of every category below it (deduplicated, cycle-safe —
 * `expandCategoryIdsWithDescendants`). Null for a malformed id, a deleted
 * category or one switched off. The branch takes sub-categories as the
 * category page does, whatever their own switch says.
 *
 * Cached under the categories tag, which every category edit — a parent
 * change included — expires (`revalidateCategoryContent`).
 */
const readCategoryBranch = unstable_cache(
  async (
    categoryId: string,
  ): Promise<{ slug: string; name: string; ids: string[] } | null> => {
    if (!mongoose.isValidObjectId(categoryId)) return null;
    await connectDB();
    const category = await Category.findOne({ _id: categoryId, isActive: true })
      .select("_id name slug")
      .lean<{ _id: unknown; name: string; slug: string } | null>();
    if (!category) return null;
    const ids = await expandCategoryIdsWithDescendants([String(category._id)]);
    return { slug: category.slug, name: category.name, ids };
  },
  ["section-product-source-category"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.categories],
  },
);

/**
 * A brand the storefront shows: approved, active and not archived. Null
 * otherwise. Cached under the brands tag, which brand edits expire.
 */
const readStorefrontBrand = unstable_cache(
  async (brandId: string): Promise<{ id: string; slug: string; name: string } | null> => {
    if (!mongoose.isValidObjectId(brandId)) return null;
    await connectDB();
    const brand = await Brand.findOne({ _id: brandId, ...STOREFRONT_BRAND_FILTER })
      .select("_id name slug")
      .lean<{ _id: unknown; name: string; slug: string } | null>();
    return brand ? { id: String(brand._id), slug: brand.slug, name: brand.name } : null;
  },
  ["section-product-source-brand"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.brands],
  },
);

function picked(products: ModernProduct[], href: string): ProductSelection {
  return products.length > 0 ? { products, href } : { products, href, missing: "empty" };
}

/**
 * A vendor's landing page: whose products a shelf reads. The slug builds the
 * store's own "View all"; a reader that only needs products (a product-group
 * tab fetched later) may leave it out.
 */
export interface ProductSourceVendor {
  id: string;
  slug?: string;
}

export { vendorProductsPath } from "@/lib/vendors/vendor-store-page";

/**
 * The products a shelf's source gives it, `limit` at most.
 *
 * `curatedQuery` is the card query the calling shelf runs for its own
 * sources; null means a hand-pick with nothing picked. Only the setting that
 * belongs to the source is read (`productSourceTarget`), so a category id
 * left behind after the shelf switched to a brand never reaches the query.
 */
export async function resolveProductSource(
  input: ProductSourceInput,
  options: {
    limit: number;
    curatedQuery: (source: CuratedProductSource) => StorefrontProductCardQuery | null;
    /**
     * A vendor's landing page: every source reads that store's products
     * alone, and a pick's "View all" opens its own Products tab.
     */
    vendor?: ProductSourceVendor;
  },
): Promise<ProductSelection> {
  const { source } = input;
  const { vendor } = options;
  const vendorScope = vendor ? { vendorId: vendor.id } : {};
  if (!isProductTargetSource(source)) {
    const query = options.curatedQuery(source as CuratedProductSource);
    return {
      products: query
        ? await getStorefrontProductCards({ ...query, ...vendorScope })
        : [],
    };
  }

  const target = productSourceTarget({
    source,
    categoryId: input.categoryId,
    brandId: input.brandId,
    collectionId: input.collectionId,
  });
  if (!target) return { products: [], missing: "unpicked" };

  if (source === "category") {
    const branch = await readCategoryBranch(target);
    if (!branch) return { products: [], missing: "unavailable" };
    const products = await getStorefrontProductCards({
      limit: options.limit,
      categoryIds: branch.ids,
      ...NEWEST_FIRST,
      ...vendorScope,
    });
    return picked(
      products,
      vendor?.slug
        ? vendorProductsPath(vendor.slug, { key: "category", slug: branch.slug })
        : `/categories/${encodeURIComponent(branch.slug)}?sortBy=createdAt`,
    );
  }

  if (source === "brand") {
    const brand = await readStorefrontBrand(target);
    if (!brand) return { products: [], missing: "unavailable" };
    const products = await getStorefrontProductCards({
      limit: options.limit,
      brandIds: [brand.id],
      ...NEWEST_FIRST,
      ...vendorScope,
    });
    return picked(
      products,
      vendor?.slug
        ? vendorProductsPath(vendor.slug, { key: "brand", slug: brand.slug })
        : `/brands/${encodeURIComponent(brand.slug)}?sort=created-desc`,
    );
  }

  const collection = vendor
    ? await readCollectionSource(target, options.limit, vendor.id)
    : await readCollectionSource(target, options.limit);
  if (!collection) return { products: [], missing: "unavailable" };
  return picked(
    collection.products.slice(0, options.limit),
    vendor?.slug
      ? vendorProductsPath(vendor.slug, { key: "collection", slug: collection.slug })
      : `/collections/${encodeURIComponent(collection.slug)}`,
  );
}
