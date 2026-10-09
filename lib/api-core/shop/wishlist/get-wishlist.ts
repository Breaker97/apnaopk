import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { Wishlist, WishlistQuery } from "@/contracts/mobile/shop/v1/wishlist";
import { defineRoute } from "@/lib/api-core/registry";
import { catalogContext, toProductCard } from "@/lib/api-core/shop/catalog/product-card";
import { nextPageCursor, pageFromCursor } from "@/lib/api-core/shop/page-cursor";
import { readWishlistCards } from "@/lib/customers/wishlist";
import { getStoreFacts } from "@/lib/storefront/store-facts";

/**
 * GET /wishlist: the saved products, newest first, as the catalogue's cards.
 * A product the store no longer sells is left out of its page.
 */
export const getWishlistRoute = defineRoute({
  id: "wishlist.get",
  method: "GET",
  path: "/wishlist",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "wishlist:list", preset: "lenient" },
  input: WishlistQuery,
  output: Wishlist,
  handler: async ({ input, session, mobileApp }) => {
    const page = pageFromCursor(input.cursor);
    const [saved, facts] = await Promise.all([
      readWishlistCards(session.user.id, { page, limit: input.limit ?? LIST_DEFAULT_LIMIT }),
      getStoreFacts(),
    ]);
    const ctx = catalogContext(facts, mobileApp);
    return {
      items: saved.items.map(({ product, addedAt }) => ({
        product: toProductCard(product, ctx),
        addedAt: addedAt.toISOString(),
      })),
      nextCursor: nextPageCursor(page, saved.totalPages),
    };
  },
});
