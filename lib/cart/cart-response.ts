import type { CartProductFacts } from "@/lib/cart/cart-products";
import type { CartView } from "@/lib/cart/cart-service";

/**
 * A cart as an API response may show it: its id and its lines.
 *
 * The cart document also carries the checkout snapshot — the shopper's email,
 * phone and addresses, their checkout answers, the recovery and checkout
 * tokens and the session id — and every cart response spread the whole
 * document, so whoever held the cookie (a recovery link hands one out) could
 * read all of it back. Routes add the figures they compute to this.
 */
export function cartResponse<T extends { _id: unknown; items?: unknown }>(
  cart: T,
): { _id: string; items: T["items"] | [] } {
  return { _id: String(cart._id), items: cart.items ?? [] };
}

/**
 * A stored line with what the read endpoints attach from its product.
 *
 * Seller identity is attached per line rather than stored on it: a cart can
 * outlive a vendor rename by weeks, and the name a shopper sees should be the
 * one on the store today. The same goes for the variant's captions
 * (lib/cart/variant-options.ts) and for final sale.
 */
export function withLineFacts<T extends object>(item: T, fact: CartProductFacts | undefined) {
  return {
    ...item,
    vendorId: fact?.vendorId,
    vendorName: fact?.vendorName,
    variantOptions: fact?.variantOptions,
    finalSale: fact?.finalSale || undefined,
  };
}

/** `GET /api/cart`'s answer for a shopper with a cart identity. */
export function cartViewResponse(view: CartView) {
  if (view.cartId === undefined) {
    return {
      items: [],
      totalItems: 0,
      subtotal: 0,
      sellerCount: 0,
      anySellerOffersPickup: false,
    };
  }
  return {
    _id: view.cartId,
    items: view.lines.map(({ item, facts }) => withLineFacts(item, facts)),
    totalItems: view.totalItems,
    subtotal: view.subtotal,
    shippableSubtotal: view.shippableSubtotal,
    totalWeight: view.totalWeight,
    hasShippableItems: view.hasShippableItems,
    hasDigitalItems: view.hasDigitalItems,
    sellerCount: view.sellerCount,
    anySellerOffersPickup: view.anySellerOffersPickup,
  };
}
