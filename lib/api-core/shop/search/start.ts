import { MeSearchStart, SearchStart } from "@/contracts/mobile/shop/v1/search";
import { defineRoute } from "@/lib/api-core/registry";
import { catalogContext, toProductCard } from "@/lib/api-core/shop/catalog/product-card";
import { toCategory } from "@/lib/api-core/shop/catalog/summaries";
import {
  readForYouProducts,
  readPopularCategories,
  readTrendingSearches,
} from "@/lib/storefront/search-start";
import { getStoreFacts } from "@/lib/storefront/store-facts";

/**
 * GET /search/start: the search screen before anything is typed, the same
 * for everybody: the store's trending terms and its popular categories.
 */
export const searchStartRoute = defineRoute({
  id: "search.start",
  method: "GET",
  path: "/search/start",
  auth: "none",
  cache: { kind: "public", sMaxAge: 60, swr: 120 },
  etag: true,
  rateLimit: { bucket: "catalog:search-start", preset: "browse" },
  output: SearchStart,
  handler: async () => {
    const [trending, categories] = await Promise.all([readTrendingSearches(), readPopularCategories()]);
    return { trending, popularCategories: categories.map(toCategory) };
  },
});

/**
 * GET /me/search/start: the private half, asked for beside it: the "For you"
 * shelf of the signed-in shopper.
 */
export const meSearchStartRoute = defineRoute({
  id: "me.search.start",
  method: "GET",
  path: "/me/search/start",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  output: MeSearchStart,
  handler: async ({ session, mobileApp }) => {
    const [products, facts] = await Promise.all([readForYouProducts(session.user.id), getStoreFacts()]);
    const ctx = catalogContext(facts, mobileApp);
    return { forYou: products.map((product) => toProductCard(product, ctx)) };
  },
});
