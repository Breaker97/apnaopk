import {
  ProductList,
  ProductListQuery,
  type ProductSort,
} from "@/contracts/mobile/shop/v1/catalog";
import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { defineRoute } from "@/lib/api-core/registry";
import { placeSponsoredInListing } from "@/lib/boosts/sponsored-placement";
import { defaultListingSort } from "@/lib/products/listing-sort";
import type { ModernProduct } from "@/lib/products/modern-product";
import { getStorefrontProducts } from "@/lib/products/storefront-products";
import { recordSearchOutcome } from "@/lib/products/zero-result-searches";
import { getStorefrontCollectionDetail } from "@/lib/storefront/storefront-collections";
import { getStoreFacts } from "@/lib/storefront/store-facts";
import type { CollectionSortOrder } from "@/types";
import { nextPageCursor, pageFromCursor } from "../page-cursor";
import { catalogContext, toProductCard } from "./product-card";

type Listing = {
  products: ModernProduct[];
  total: number;
  totalPages: number;
  searchCorrection?: { from: string; to: string };
};

/** The storefront grid's order for each of the contract's. */
const GRID_SORT: Record<ProductSort, { sortBy: string; sortOrder?: string }> = {
  RELEVANCE: { sortBy: "relevance" },
  POPULAR: { sortBy: "popular" },
  NEWEST: { sortBy: "createdAt", sortOrder: "desc" },
  PRICE_ASC: { sortBy: "price-asc" },
  PRICE_DESC: { sortBy: "price-desc" },
  RATING: { sortBy: "rating" },
};

/**
 * The collection page's order for each of the contract's it has; RELEVANCE
 * (and no sort) is the order the store gave the collection.
 */
const COLLECTION_SORT: Partial<Record<ProductSort, CollectionSortOrder | undefined>> = {
  RELEVANCE: undefined,
  NEWEST: "created-desc",
  PRICE_ASC: "price-asc",
  PRICE_DESC: "price-desc",
};

/**
 * A listing of exactly one collection and nothing else is the collection's
 * own page, which the web lists in the collection's order (the store's
 * choice, or the shopper's sort). Anything narrower is the product grid.
 */
function isCollectionPage(query: ProductListQuery): query is ProductListQuery & { collection: string } {
  return (
    Boolean(query.collection) &&
    !query.q &&
    !query.category &&
    !query.brand &&
    !query.vendor &&
    !query.onSale &&
    !query.inStock &&
    query.minPrice === undefined &&
    query.maxPrice === undefined &&
    (query.sort === undefined || query.sort in COLLECTION_SORT)
  );
}

async function readListing(query: ProductListQuery, page: number, limit: number): Promise<Listing> {
  if (isCollectionPage(query)) {
    const detail = await getStorefrontCollectionDetail({
      slug: query.collection,
      page,
      limit,
      sort: query.sort ? COLLECTION_SORT[query.sort] : undefined,
    });
    if (!detail) return { products: [], total: 0, totalPages: 0 };
    return {
      products: detail.products as unknown as ModernProduct[],
      total: detail.pagination.total,
      totalPages: detail.pagination.totalPages,
    };
  }

  // No order chosen is the web listing's default (relevance for a search,
  // else popularity), and so is relevance with nothing searched for.
  const sort =
    query.sort && !(query.sort === "RELEVANCE" && !query.q)
      ? GRID_SORT[query.sort]
      : { sortBy: defaultListingSort(Boolean(query.q)) };
  const result = await getStorefrontProducts<ModernProduct>({
    page,
    limit,
    search: query.q,
    category: query.category,
    collection: query.collection,
    brand: query.brand,
    vendor: query.vendor,
    onSale: query.onSale,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    inStock: query.inStock,
    ...sort,
    cardFieldsOnly: true,
  });
  return {
    products: result.data,
    total: result.pagination.total,
    totalPages: result.pagination.totalPages,
    ...(result.searchCorrection ? { searchCorrection: result.searchCorrection } : {}),
  };
}

/**
 * GET /products: the catalogue's listing and search, the web's product grid
 * (`getStorefrontProducts`, cached on the catalogue tags), a page of cards at
 * a time. Per request, because the query is the shopper's; the same for every
 * shopper who sends it, so a CDN may keep it for a minute.
 */
export const productListRoute = defineRoute({
  id: "catalog.products.list",
  method: "GET",
  path: "/products",
  auth: "none",
  cache: { kind: "public", sMaxAge: 60, swr: 120 },
  etag: true,
  rateLimit: { bucket: "catalog:products", preset: "browse" },
  input: ProductListQuery,
  output: ProductList,
  handler: async ({ input, client, mobileApp }) => {
    const page = pageFromCursor(input.cursor);
    const [listing, facts] = await Promise.all([
      readListing(input, page, input.limit ?? LIST_DEFAULT_LIMIT),
      getStoreFacts(),
    ]);

    // A search that found nothing is a product the store does not have: the
    // admin's Search insights count it, as they do the web's searches.
    recordSearchOutcome({
      search: input.q,
      page,
      total: listing.total,
      facets: {
        category: input.category,
        collection: input.collection,
        brand: input.brand,
        vendor: input.vendor,
        onSale: input.onSale,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        inStock: input.inStock,
      },
      clientKey: client.installId ?? client.ip,
    });

    // Paid placements on a plain listing's first page, as the web's grid
    // places them (lib/boosts/sponsored-placement.ts).
    const products = await placeSponsoredInListing(listing.products, {
      page,
      search: input.q,
      brand: input.brand,
      collection: input.collection,
      vendor: input.vendor,
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
    });

    const ctx = catalogContext(facts, mobileApp);
    return {
      items: products.map((product) => toProductCard(product, ctx)),
      nextCursor: nextPageCursor(page, listing.totalPages),
      total: listing.total,
      ...(listing.searchCorrection ? { searchCorrection: listing.searchCorrection } : {}),
    };
  },
});
