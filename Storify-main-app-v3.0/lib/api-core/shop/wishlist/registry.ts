import type { RouteEntry } from "@/lib/api-core/registry";
import { addToWishlistRoute, removeFromWishlistRoute } from "./change-wishlist";
import { getWishlistRoute } from "./get-wishlist";

/**
 * The shopper's wishlist.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const wishlistRoutes: readonly RouteEntry[] = [
  getWishlistRoute,
  addToWishlistRoute,
  removeFromWishlistRoute,
];
