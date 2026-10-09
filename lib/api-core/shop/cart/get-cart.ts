import { CART_REASONS, Cart } from "@/contracts/mobile/shop/v1/cart";
import { defineRoute } from "@/lib/api-core/registry";
import { getCartView } from "@/lib/cart/cart-service";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import { appCartIdentity, emptyAppCart, toAppCart } from "./app-cart";

/**
 * GET /cart: the account's cart when signed in, else the guest's by
 * `X-Cart-Token`; an empty cart for neither. Read only: a guest's cart is
 * merged into the account's by POST /cart/merge, never here.
 */
export const getCartRoute = defineRoute({
  id: "cart.get",
  method: "GET",
  path: "/cart",
  auth: "optional",
  cache: { kind: "private" },
  etag: true,
  // Read on many screens: the browse preset, like the web's guest cart read.
  rateLimit: { bucket: "cart:get", preset: "browse" },
  output: Cart,
  reasons: { values: CART_REASONS },
  handler: async ({ session, client, mobileApp }) => {
    const identity = appCartIdentity(session, client);
    const [currency, view] = await Promise.all([
      getStoreCurrency(),
      identity ? getCartView(identity, { forApp: true }) : null,
    ]);
    if (!view) return emptyAppCart(currency);
    return toAppCart(view, { currency, shop: mobileApp });
  },
});
