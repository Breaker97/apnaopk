/**
 * The search start page: what the search screen shows before anything is
 * typed. Two new routes, read side by side like the product page's public
 * and private halves; neither is part of GET /products or GET /config.
 *
 * - GET /search/start (auth none, public: `Cache-Control` s-maxage 60,
 *   stale-while-revalidate 120, `ETag`): the same for everybody, so a CDN
 *   may keep it. The trending terms and the popular categories.
 * - GET /me/search/start (auth user, private, `ETag`): the "For you" shelf
 *   of one shopper. A guest does not ask: their shelf is empty. Empty too
 *   while the store has nothing to go on (nothing saved, bought or chosen).
 *
 * A trending term is searched as typed: GET /products?q={term}. A category
 * opens GET /products?category={slug}. Hide a section whose list is empty.
 */
import * as z from "zod";

import { Category, ProductCard } from "./catalog";

/** GET /search/start */
export const SearchStart = z.object({
  /**
   * The terms the store calls trending (Online Store → Header → Search), in
   * its order, as it typed them. Empty when it typed none.
   */
  trending: z.array(z.string()),
  /**
   * The store's popular categories: the ones it marks featured, in its
   * order; without any, the ones holding the most products. Eight at most,
   * each with the categories inside it, as GET /categories has them.
   */
  popularCategories: z.array(Category),
});
export type SearchStart = z.infer<typeof SearchStart>;

/** GET /me/search/start */
export const MeSearchStart = z.object({
  /**
   * Products picked for this shopper, from the categories of what they saved
   * and bought, the best rated in stock first, none they already saved or
   * bought. Twelve at most; empty when there is nothing to pick from.
   */
  forYou: z.array(ProductCard),
});
export type MeSearchStart = z.infer<typeof MeSearchStart>;
