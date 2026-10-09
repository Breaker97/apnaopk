/**
 * Cart.
 *
 * A guest's cart is found by the `X-Cart-Token` header. The server creates the
 * token with the first line and returns it as `cartToken`; the app keeps it and
 * sends it from then on. After sign-in, POST /cart/merge moves the guest's
 * lines into the account's cart.
 *
 * PUT /cart/lines sets a quantity, it does not add to one, so sending the same
 * request twice leaves the cart as sending it once would.
 *
 * A signed-in shopper has one cart, shared with the store's website: lines
 * added there show here too, including kinds the app cannot check out yet. A
 * line like that carries a `reason`; the shopper can still remove it.
 */
import * as z from "zod";

import { Availability, NamedLink } from "./catalog";
import { ImageSet, Money } from "./common";

/**
 * `reason` values of the cart endpoints. A refused change answers 409
 * CONFLICT with one of them; a line that cannot be checked out in the app as
 * it stands carries one too.
 */
export const CART_REASONS = [
  /** None left. */
  "OUT_OF_STOCK",
  /** Fewer left than asked for: `CartQuantityLimitedDetails`. */
  "QUANTITY_LIMITED",
  /** The product has options: send the chosen variant. */
  "VARIANT_REQUIRED",
  /** The store does not sell this inside the app (digital goods). */
  "NOT_PURCHASABLE_IN_APP",
  /** The product or the variant is no longer sold. */
  "NOT_AVAILABLE",
  /** Sold by quote, and this shopper holds no offer for this quantity. */
  "PRICE_ON_REQUEST",
  /** A quoted line holds the quantity that was quoted: it can only be removed. */
  "QUOTED_QUANTITY",
  /** A pre-order, which the app cannot place yet. */
  "PRE_ORDER",
  /** The cart holds pre-orders, which are checked out apart from regular items. */
  "MIXED_PURCHASE_TYPES",
  /** The cart holds as many different lines as it can. */
  "CART_FULL",
] as const;
export const CartReason = z.enum(CART_REASONS);
export type CartReason = z.infer<typeof CartReason>;

/** The `details` of QUANTITY_LIMITED. */
export const CartQuantityLimitedDetails = z.object({
  maxQuantity: z.number().int(),
});
export type CartQuantityLimitedDetails = z.infer<typeof CartQuantityLimitedDetails>;

export const CartLine = z.object({
  /** Names the line in DELETE /cart/lines/{key}. */
  key: z.string(),
  productId: z.string(),
  variantId: z.string().optional(),
  slug: z.string(),
  name: z.string(),
  /** The chosen options as one line of text, written by the server. */
  variantLabel: z.string().optional(),
  image: ImageSet.optional(),
  quantity: z.number().int(),
  /** The most the shopper may set. */
  maxQuantity: z.number().int(),
  unitPrice: Money,
  compareAtUnitPrice: Money.optional(),
  lineTotal: Money,
  availability: Availability,
  vendor: NamedLink.optional(),
  /**
   * Why this line cannot be checked out in the app as it stands (a pre-order,
   * too few left, …). Left out when it can.
   */
  reason: CartReason.optional(),
});
export type CartLine = z.infer<typeof CartLine>;

/** GET /cart, and the answer to every change of the cart. */
export const Cart = z.object({
  lines: z.array(CartLine),
  /** The quantities added up: the number on the cart's badge. */
  itemCount: z.number().int(),
  subtotal: Money,
  /** Sent when the server has just created a guest cart. */
  cartToken: z.string().optional(),
});
export type Cart = z.infer<typeof Cart>;

/** PUT /cart/lines */
export const SetCartLineRequest = z.object({
  productId: z.string(),
  variantId: z.string().optional(),
  quantity: z.number().int().min(1),
});
export type SetCartLineRequest = z.infer<typeof SetCartLineRequest>;
