/**
 * The shopper's wishlist.
 *
 * Adding or removing one product, PUT and DELETE /wishlist/{productId},
 * answers with `WishlistChange` (me.ts), the private half of the product page.
 * Both are safe to repeat: adding a product already there, or removing one
 * that is not, changes nothing.
 */
import * as z from "zod";

import { ProductCard } from "./catalog";
import { ListQuery, listOf } from "./common";

/** GET /wishlist */
export const WishlistQuery = ListQuery;
export type WishlistQuery = z.infer<typeof WishlistQuery>;

/**
 * One saved product. A product the store no longer sells is left out of the
 * list, so the list may hold fewer items than `limit` before its last page.
 */
export const WishlistItem = z.object({
  product: ProductCard,
  /** When the shopper saved it. */
  addedAt: z.string(),
});
export type WishlistItem = z.infer<typeof WishlistItem>;

/** GET /wishlist: newest first. */
export const Wishlist = listOf(WishlistItem);
export type Wishlist = z.infer<typeof Wishlist>;
