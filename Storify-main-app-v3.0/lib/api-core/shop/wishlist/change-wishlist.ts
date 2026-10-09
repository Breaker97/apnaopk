import { WishlistChange } from "@/contracts/mobile/shop/v1/me";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { addToWishlist, removeFromWishlist } from "@/lib/customers/wishlist";

const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * Saving and unsaving share one counter, on the general preset: a heart is
 * tapped often while browsing, and the website's wishlist is not limited at
 * all.
 */
const WISHLIST_WRITE_LIMIT = { bucket: "wishlist:write", preset: "lenient" } as const;

/**
 * PUT /wishlist/{productId}: save it. Saving one already saved changes
 * nothing. A product the store does not sell is refused (400, on
 * `productId`).
 */
export const addToWishlistRoute = defineRoute({
  id: "wishlist.add",
  method: "PUT",
  path: "/wishlist/{productId}",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: WISHLIST_WRITE_LIMIT,
  demo: "default",
  output: WishlistChange,
  handler: async ({ params, session }) => {
    if (!OBJECT_ID.test(params.productId)) {
      throw new MobileApiError(404, "NOT_FOUND", "Product not found");
    }
    await addToWishlist(session.user.id, params.productId);
    return { inWishlist: true };
  },
});

/** DELETE /wishlist/{productId}: take it out; one not saved changes nothing. */
export const removeFromWishlistRoute = defineRoute({
  id: "wishlist.remove",
  method: "DELETE",
  path: "/wishlist/{productId}",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: WISHLIST_WRITE_LIMIT,
  demo: "allow",
  output: WishlistChange,
  handler: async ({ params, session }) => {
    await removeFromWishlist(session.user.id, params.productId);
    return { inWishlist: false };
  },
});
