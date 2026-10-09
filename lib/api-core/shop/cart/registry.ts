import type { RouteEntry } from "@/lib/api-core/registry";
import { getCartRoute } from "./get-cart";
import { mergeCartRoute } from "./merge-cart";
import { removeCartLineRoute } from "./remove-cart-line";
import { setCartLineRoute } from "./set-cart-line";

/**
 * The cart, its lines, and merging a guest's cart after sign-in.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const cartRoutes: readonly RouteEntry[] = [
  getCartRoute,
  setCartLineRoute,
  removeCartLineRoute,
  mergeCartRoute,
];
