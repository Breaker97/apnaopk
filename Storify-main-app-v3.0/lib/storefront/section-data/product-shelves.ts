import "server-only";

import {
  getStorefrontProductCards,
  type StorefrontProductCardQuery,
} from "@/lib/products/storefront-product-cards";
import { getStorefrontProducts } from "@/lib/products/storefront-products";
import type { ModernProduct } from "@/lib/products/modern-product";
import {
  NEW_ARRIVALS_COLUMNS_MAX,
  NEW_ARRIVALS_COLUMNS_MIN,
  NEW_ARRIVALS_LIMIT_MAX,
  NEW_ARRIVALS_LIMIT_MIN,
  PRODUCT_BROWSER_ROWS_MAX,
  PRODUCT_BROWSER_ROWS_MIN,
  type FeaturedProductsSource,
  type NewArrivalsSource,
  type ProductBrowserLayout,
} from "@/lib/site-config/home-page-config";
import { clampDesktopColumns } from "@/lib/storefront/sections/shelf-columns";
import { isProductTargetSource } from "@/lib/storefront/sections/product-source";
import { getStorefrontCategories } from "@/lib/storefront/storefront-categories";
import { getVendorStoreTaxonomy } from "@/lib/vendors/vendor-store-taxonomy";
import {
  resolveProductSource,
  vendorProductsPath,
  type CuratedProductSource,
  type ProductSourceInput,
  type ProductSourceMissing,
} from "./product-source";

/**
 * A vendor's landing page: every shelf reads that store's products alone,
 * and "View all" opens its own Products tab.
 */
interface ShelfVendor {
  vendor?: { id: string; slug: string };
}

/** The store's own newest products, or the marketplace's. */
function scopedLatest(limit: number, vendor?: { id: string }): StorefrontProductCardQuery {
  return { ...latestQuery(limit), ...(vendor ? { vendorId: vendor.id } : {}) };
}

/**
 * The product shelves of the home page: the carousel (product-grid) and the
 * catalogue browser (product-browser); the tabbed group is product-group.ts.
 * Each loader is the section's whole data rule — which products, how many,
 * and what stands in when the chosen source has none — so the web's
 * components and the shopper app's home show the same cards.
 */

/** Newest first: what every source falls back to, and the "all" source. */
function latestQuery(limit: number): StorefrontProductCardQuery {
  return { limit, sortBy: "createdAt", sortOrder: "desc" };
}

/** The card query for a curated source, or null for a hand-pick with nothing picked. */
function curatedQuery(
  source: CuratedProductSource,
  limit: number,
  productIds: string[],
  manualMax: number,
): StorefrontProductCardQuery | null {
  if (source === "manual") {
    const ids = productIds.filter(Boolean);
    if (ids.length === 0) return null;
    return { ids, limit: Math.min(ids.length, manualMax) };
  }
  const query = latestQuery(limit);
  if (source === "discounted") query.onSale = true;
  if (source === "featured") query.featured = true;
  return query;
}

/** The carousel's card count, clamped to the shared shelf bounds. */
function productShelfLimit(limit: number | undefined): number {
  return Math.min(
    NEW_ARRIVALS_LIMIT_MAX,
    Math.max(NEW_ARRIVALS_LIMIT_MIN, Math.floor(limit ?? 8) || 8),
  );
}

/** The carousel's cards across one desktop row. */
export function productShelfColumns(desktopColumns: number | undefined): number {
  const normalized = Number.isFinite(desktopColumns) ? Math.floor(desktopColumns as number) : 4;
  return Math.min(NEW_ARRIVALS_COLUMNS_MAX, Math.max(NEW_ARRIVALS_COLUMNS_MIN, normalized));
}

/**
 * The carousel's "View all" for its own sources. The catalogue reads only
 * category, brand, collection, search, price and sort, so there is no on-sale
 * or featured filter to carry over: those sources land on the catalogue,
 * newest first to match the carousel's own order. A picked category, brand or
 * collection leads to its own page instead (`ProductSelection.href`).
 */
export const PRODUCT_SHELF_VIEW_ALL_PATH = "/products?sortBy=createdAt";

/** What the carousel draws, and where its "View all" leads. */
export interface ProductShelfData {
  products: ModernProduct[];
  /** A storefront path without the locale. */
  href: string;
  /** A picked category, brand or collection with nothing to show, and why. */
  missing?: ProductSourceMissing;
}

/**
 * The product carousel ("Products on Sale"): its source's products. A shelf
 * of its own sources (newest, featured, on sale, hand-picked) shows the
 * newest products when that source has none, so it is never empty while the
 * store has anything to sell. A picked category, brand or collection shows
 * its own products or nothing — never the newest of the whole store.
 */
export async function loadProductShelf(
  options: ProductSourceInput &
    ShelfVendor & {
      source: NewArrivalsSource;
      limit: number | undefined;
    },
): Promise<ProductShelfData> {
  const { vendor } = options;
  const limit = productShelfLimit(options.limit);
  const viewAll = vendor ? vendorProductsPath(vendor.slug) : PRODUCT_SHELF_VIEW_ALL_PATH;
  const selection = await resolveProductSource(options, {
    limit,
    curatedQuery: (source) =>
      curatedQuery(source, limit, options.productIds, NEW_ARRIVALS_LIMIT_MAX),
    ...(vendor ? { vendor } : {}),
  });
  if (isProductTargetSource(options.source)) {
    return {
      products: selection.products.slice(0, limit),
      href: selection.href ?? viewAll,
      ...(selection.missing ? { missing: selection.missing } : {}),
    };
  }
  let products = selection.products;
  if (products.length === 0 && options.source !== "latest") {
    products = await getStorefrontProductCards(scopedLatest(limit, vendor));
  }
  return { products: products.slice(0, limit), href: viewAll };
}

type BrowserProduct = ModernProduct & {
  category?: string | { _id?: string; name?: string; slug?: string };
};

/** What the catalogue browser section draws. */
type ProductBrowserData =
  | {
      /** A plain grid: exactly the cards it shows, nothing around them. */
      kind: "plain";
      products: BrowserProduct[];
      columns: number;
      /** A picked category, brand or collection: where "See all" leads. */
      href?: string;
      /** A picked category, brand or collection with nothing to show, and why. */
      missing?: ProductSourceMissing;
    }
  | {
      /** The browser: category chips, and more pages as the shopper scrolls. */
      kind: "browser";
      products: BrowserProduct[];
      hasNext: boolean;
      /** Cards per page, the first included. */
      pageSize: number;
      /**
       * A vendor's landing page: the store's slug, which every later page
       * the shopper loads carries, and where "All Categories" leads.
       */
      vendorSlug?: string;
      allCategoriesHref?: string;
      /**
       * Where the grid stops: its rows × columns. Absent when it scrolls on
       * for ever (the section's "Endless scroll").
       */
      maxProducts?: number;
      categories: { name: string; slug: string }[];
      columns: number;
    }
  | {
      /** A curated source without the browser's chrome. */
      kind: "shelf";
      products: BrowserProduct[];
      columns: number;
      /** A picked category, brand or collection: where "See all" leads. */
      href?: string;
      /** A picked category, brand or collection with nothing to show, and why. */
      missing?: ProductSourceMissing;
    };

/**
 * Rows of cards the browser reads at a time: the first page, then each one
 * the shopper scrolls to. Four rows of at most six columns is 24 cards, under
 * every reader's page limit (the shopper app's GET /products takes 40), so a
 * page is always whole rows.
 */
const BROWSER_PAGE_ROWS = 4;

/**
 * The catalogue browser (product-browser). Its size is whole rows: rows ×
 * desktop columns, so no layout leaves a ragged last row. In the builder's
 * framed preview the endless browser shows one row (`preview`). Null when the
 * browser or a curated source has nothing to show.
 *
 * A picked category, brand or collection is one fixed shelf in either
 * layout — never the endless browser, whose later pages and category chips
 * read the whole catalogue — and never falls back to the newest products:
 * with nothing to show it answers an empty shelf that says why (`missing`).
 */
export async function loadProductBrowser(
  options: Omit<ProductSourceInput, "source"> &
    ShelfVendor & {
    source: FeaturedProductsSource;
    layout: ProductBrowserLayout;
    rows: number | undefined;
    desktopColumns: number | undefined;
    /** The browser layout keeps loading past its rows. */
    endless?: boolean;
    preview?: boolean;
  },
): Promise<ProductBrowserData | null> {
  const { source, layout, productIds, vendor } = options;
  const endless = options.endless === true;
  const columns = clampDesktopColumns(options.desktopColumns);
  const rows = Math.min(
    PRODUCT_BROWSER_ROWS_MAX,
    Math.max(PRODUCT_BROWSER_ROWS_MIN, Math.floor(options.rows ?? 2) || 2),
  );
  const total = rows * columns;
  // A hand-picked list is as long as the largest grid it can fill.
  const manualMax = PRODUCT_BROWSER_ROWS_MAX * NEW_ARRIVALS_COLUMNS_MAX;

  // Every layout but the endless browser is one fixed shelf of `total`
  // cards: the plain grid for every source, and the browser layout for every
  // source but "all".
  if (layout === "plain" || source !== "all") {
    const kind = layout === "plain" ? "plain" : "shelf";
    const selection = await resolveProductSource(
      // The plain grid's "all" is simply the newest products.
      { ...options, source: source === "all" ? "latest" : source },
      {
        limit: total,
        curatedQuery: (curated) =>
          curatedQuery(curated, total, productIds, manualMax),
        ...(vendor ? { vendor } : {}),
      },
    );
    if (isProductTargetSource(source)) {
      return {
        kind,
        products: selection.products.slice(0, total),
        columns,
        ...(selection.href ? { href: selection.href } : {}),
        ...(selection.missing ? { missing: selection.missing } : {}),
      };
    }
    // A shelf of its own sources, and the newest products when it has none,
    // so the section is never empty.
    let products: BrowserProduct[] = selection.products;
    if (products.length === 0 && source !== "latest" && source !== "all") {
      products = await getStorefrontProductCards(scopedLatest(total, vendor));
    }
    if (kind === "shelf" && !products.length) return null;
    return { kind, products: products.slice(0, total), columns };
  }

  const pageSize =
    (endless && options.preview ? 1 : Math.min(rows, BROWSER_PAGE_ROWS)) * columns;
  const [result, categories] = await Promise.all([
    getStorefrontProducts<BrowserProduct>({
      page: 1,
      limit: pageSize,
      sortBy: "createdAt",
      sortOrder: "desc",
      cardFieldsOnly: true,
      ...(vendor ? { vendor: vendor.id } : {}),
    }),
    // A vendor's chips are the store's own categories.
    vendor
      ? getVendorStoreTaxonomy(vendor.id)
          .then((taxonomy) =>
            taxonomy.categories.map((category) => ({
              name: category.name,
              slug: category.slug,
            })),
          )
          .catch(() => [])
      : getStorefrontCategories({ flat: true, limit: 50 }).then((categoryResult) =>
          categoryResult.categories.map((category) => ({
            name: category.name,
            slug: category.slug,
          })),
        ),
  ]);
  if (!result.data.length) return null;
  return {
    kind: "browser",
    products: result.data,
    hasNext: result.pagination.hasNext,
    pageSize,
    ...(endless ? {} : { maxProducts: total }),
    categories,
    columns,
    ...(vendor
      ? { vendorSlug: vendor.slug, allCategoriesHref: vendorProductsPath(vendor.slug) }
      : {}),
  };
}
