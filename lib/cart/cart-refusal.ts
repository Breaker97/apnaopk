import { ValidationError } from "@/lib/api/errors";
import {
  getPurchasableQuantity,
  type StockPolicySource,
} from "@/lib/products/stock-policy";

/**
 * Why the cart would not take a line, in the cart's own words. The mobile API
 * maps each to a reason of its contract (lib/api-core/shop/cart/); the web
 * answers with the message alone.
 */
export type CartRefusalReason =
  /** The product or its variant is no longer sold. */
  | "not_available"
  | "variant_required"
  /** Sold by quote, and this shopper holds no offer for this lot. */
  | "price_on_request"
  | "out_of_stock"
  /** Fewer are available than asked for: see `maxQuantity`. */
  | "quantity_limited"
  /** Pre-orders and regular items are checked out apart, never together. */
  | "mixed_purchase_types"
  | "cart_full"
  /** A quoted line holds the lot the merchant quoted; it can only be removed. */
  | "quoted_quantity"
  /** Refused by the caller's own rules: the app takes no pre-orders yet. */
  | "pre_order"
  /** Refused by the caller's own rules: not sold inside the app. */
  | "not_purchasable_in_app";

/**
 * A line the cart will not take.
 *
 * It is a `ValidationError`, so the web answers it exactly as it always has: a
 * 400 with the message. `reason` and `maxQuantity` are for a caller that
 * reacts to why, and are deliberately not `details`, which the web's error
 * envelope would echo.
 */
export class CartRefusal extends ValidationError {
  constructor(
    message: string,
    readonly reason: CartRefusalReason,
    /** With `quantity_limited`: the most this line may hold right now. */
    readonly maxQuantity?: number,
  ) {
    super(message);
  }
}

/**
 * The most units one cart line may hold through a quantity change: the web's
 * line route accepts 0–100 (`CartItemQuantitySchema`), and an add takes at
 * most 100 at a time (`CartAddByIdSchema`).
 */
export const CART_LINE_QUANTITY_LIMIT = 100;

type StockedProduct = StockPolicySource & {
  stock?: number;
  variants?: Array<{ _id?: unknown; stock?: number }>;
};

/** The stock that limits this line: the variant's when it has one. */
function lineStock(product: StockedProduct, variantId?: string): number | undefined {
  if (!variantId) return product.stock;
  return product.variants?.find((variant) => String(variant._id) === variantId)?.stock;
}

/**
 * "Insufficient stock", told apart: nothing left, or less than was asked for.
 * How many are left comes from the stock policy, never from `stock` itself.
 */
export function insufficientStock(product: StockedProduct, variantId?: string): CartRefusal {
  const available = getPurchasableQuantity(product, lineStock(product, variantId));
  return available > 0
    ? new CartRefusal(
        "Insufficient stock",
        "quantity_limited",
        Math.min(available, CART_LINE_QUANTITY_LIMIT),
      )
    : new CartRefusal("Insufficient stock", "out_of_stock");
}
