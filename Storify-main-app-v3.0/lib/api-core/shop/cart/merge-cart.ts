import { CART_REASONS, Cart } from "@/contracts/mobile/shop/v1/cart";
import { defineRoute } from "@/lib/api-core/registry";
import { getCartView, mergeGuestCart } from "@/lib/cart/cart-service";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import { toAppCart } from "./app-cart";

/**
 * POST /cart/merge, after sign-in: the guest cart named by `X-Cart-Token`
 * joins the account's cart, and is gone. Quantities of the same line add up;
 * a guest line of the other purchase type than the account's line for the
 * same product is dropped (pre-orders and regular items never mix). Answers
 * the account's cart. Repeating it, or sending no token, merges nothing.
 */
export const mergeCartRoute = defineRoute({
  id: "cart.merge",
  method: "POST",
  path: "/cart/merge",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "cart:merge", preset: "moderate" },
  demo: "default",
  output: Cart,
  reasons: { values: CART_REASONS },
  handler: async ({ session, client, mobileApp }) => {
    const userId = session.user.id;
    if (client.cartToken) await mergeGuestCart(userId, client.cartToken);
    const [currency, view] = await Promise.all([
      getStoreCurrency(),
      getCartView({ userId }, { forApp: true }),
    ]);
    return toAppCart(view, { currency, shop: mobileApp });
  },
});
