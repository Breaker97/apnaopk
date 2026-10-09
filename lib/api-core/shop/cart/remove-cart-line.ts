import { CART_REASONS, Cart } from "@/contracts/mobile/shop/v1/cart";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { getCartView, removeCartLine } from "@/lib/cart/cart-service";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import { appCartIdentity, emptyAppCart, parseCartLineKey, toAppCart } from "./app-cart";

/**
 * DELETE /cart/lines/{key}: takes the line out. Removing a line that is not
 * there answers the cart as it is, so a retry is harmless.
 */
export const removeCartLineRoute = defineRoute({
  id: "cart.lines.remove",
  method: "DELETE",
  path: "/cart/lines/{key}",
  auth: "optional",
  cache: { kind: "private" },
  // As generous as setting a line (set-cart-line.ts): tidying a cart is
  // not something to ration.
  rateLimit: { bucket: "cart:remove-line", preset: "lenient" },
  demo: "allow",
  output: Cart,
  reasons: { values: CART_REASONS },
  handler: async ({ params, session, client, mobileApp }) => {
    const line = parseCartLineKey(params.key);
    if (!line) throw new MobileApiError(404, "NOT_FOUND", "There is no such line in the cart.");

    const identity = appCartIdentity(session, client);
    const [currency, result] = await Promise.all([
      getStoreCurrency(),
      identity ? removeCartLine(identity, line) : null,
    ]);
    if (!identity || !result || !("cart" in result)) return emptyAppCart(currency);

    const view = await getCartView(identity, { forApp: true, cart: result.cart.toObject() });
    return toAppCart(view, { currency, shop: mobileApp });
  },
});
