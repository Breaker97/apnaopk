import { randomUUID } from "node:crypto";
import { CART_REASONS, Cart, SetCartLineRequest } from "@/contracts/mobile/shop/v1/cart";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { CART_LINE_QUANTITY_LIMIT } from "@/lib/cart/cart-refusal";
import { getCartView, setCartLine } from "@/lib/cart/cart-service";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import {
  admitInApp,
  appCartIdentity,
  parseCartLineKey,
  toAppCart,
  withCartReasons,
} from "./app-cart";

/**
 * PUT /cart/lines: the line holds exactly `quantity`. A line not in the cart
 * is added; one already at that quantity is left alone, so a retry changes
 * nothing. A guest without a cart gets one, and its token as `cartToken`.
 *
 * The store's rules are the web's (stock, variants, quote offers, pre-orders
 * apart from regular items); the app adds its own: no pre-orders yet, and no
 * digital goods unless the store sells them in its app.
 */
export const setCartLineRoute = defineRoute({
  id: "cart.lines.set",
  method: "PUT",
  path: "/cart/lines",
  auth: "optional",
  cache: { kind: "private" },
  // Adding a product and every change of a line's quantity, in one counter:
  // the general preset, so a shopper filling a cart is never turned away.
  // The web counts its adds and its quantity changes apart, 20 each.
  rateLimit: { bucket: "cart:set-line", preset: "lenient" },
  demo: "default",
  input: SetCartLineRequest,
  output: Cart,
  reasons: { values: CART_REASONS },
  handler: async ({ input, session, client, mobileApp }) => {
    const line = parseCartLineKey(
      input.variantId ? `${input.productId}-${input.variantId}` : input.productId,
    );
    if (!line) throw new MobileApiError(404, "NOT_FOUND", "Product not found");
    if (input.quantity > CART_LINE_QUANTITY_LIMIT) {
      throw new MobileApiError(409, "CONFLICT", "Too many of one item", {
        reason: "QUANTITY_LIMITED",
        details: { maxQuantity: CART_LINE_QUANTITY_LIMIT },
      });
    }

    // A guest's first line creates the cart, and the token that finds it again.
    const known = appCartIdentity(session, client);
    const createdToken = known ? undefined : randomUUID();
    const identity = known ?? { sessionId: createdToken! };

    const result = await withCartReasons(() =>
      setCartLine(
        identity,
        { ...line, quantity: input.quantity },
        { upsert: true, admit: admitInApp(mobileApp) },
      ),
    );
    if (result.status === "product-not-found") {
      throw new MobileApiError(404, "NOT_FOUND", "Product not found");
    }
    if (result.status === "variant-not-found") {
      throw new MobileApiError(404, "NOT_FOUND", "Variant not found");
    }
    if (result.status !== "saved") throw new Error(`cart.lines.set: unexpected ${result.status}`);

    const [currency, view] = await Promise.all([
      getStoreCurrency(),
      getCartView(identity, { forApp: true, cart: result.cart.toObject() }),
    ]);
    return toAppCart(view, { currency, shop: mobileApp, cartToken: createdToken });
  },
});
