/**
 * Single source of truth for "can this be bought right now, and how many?".
 *
 * Comparing `product.stock` directly is wrong for two kinds of product:
 *
 *   - **Digital products.** A download has unlimited copies, and the product
 *     form deliberately hides the Inventory card for them — so `stock` stays 0
 *     forever and every naive `stock > 0` check reports "out of stock".
 *   - **Products with "Track quantity" off.** The merchant has said the number
 *     is not a limit.
 *
 * A third case keeps selling past zero instead of blocking the sale:
 * **"Continue selling when out of stock"** — stock still moves (and may go
 * negative, which an inventory reconcile corrects), the buyer is just never
 * turned away.
 *
 * Every buy box, cart guard, card badge and inventory write reads these helpers
 * rather than `stock` so the two admin switches and the storefront can never
 * disagree. Digital is folded in here (not only normalized on write) so
 * products saved before the flag existed behave correctly with no migration.
 */

export type StockPolicySource = {
  shipping?: { isPhysicalProduct?: boolean } | null;
  inventory?: {
    tracked?: boolean;
    continueSellingWhenOutOfStock?: boolean;
  } | null;
};

/**
 * Units of a single product one order may take when stock isn't the limit.
 * Matches the pre-order cap in the product detail buy box.
 */
export const UNTRACKED_PURCHASE_CAP = 100;

/** Digital/service product — nothing ships, so nothing runs out. */
export function isDigitalProduct(product: StockPolicySource | null | undefined) {
  return product?.shipping?.isPhysicalProduct === false;
}

/** False when `stock` carries no meaning for this product. */
export function productTracksStock(
  product: StockPolicySource | null | undefined,
) {
  if (isDigitalProduct(product)) return false;
  return product?.inventory?.tracked !== false;
}

/** True when a sale must never be blocked by the stock on hand. */
export function productAllowsOversell(
  product: StockPolicySource | null | undefined,
) {
  if (!productTracksStock(product)) return true;
  return product?.inventory?.continueSellingWhenOutOfStock === true;
}

/**
 * How many units the buyer may still add to the cart. `stock` is the relevant
 * count for the selection (variant stock when a variant is chosen, otherwise
 * the product's).
 */
export function getPurchasableQuantity(
  product: StockPolicySource | null | undefined,
  stock: number | null | undefined,
) {
  if (productAllowsOversell(product)) return UNTRACKED_PURCHASE_CAP;
  const available = Number(stock);
  return Number.isFinite(available) ? Math.max(0, available) : 0;
}

/** Storefront "in stock" / "out of stock" decision. */
export function isProductAvailable(
  product: StockPolicySource | null | undefined,
  stock: number | null | undefined,
) {
  return getPurchasableQuantity(product, stock) > 0;
}

/**
 * MongoDB equivalent of {@link isProductAvailable} for the storefront's
 * `?inStock=true` filter. Must stay in step with the helpers above — a product
 * the filter hides but the buy box would sell (or vice versa) is a bug.
 */
export const AVAILABLE_STOCK_QUERY = {
  $or: [
    { stock: { $gt: 0 } },
    { "shipping.isPhysicalProduct": false },
    { "inventory.tracked": false },
    { "inventory.continueSellingWhenOutOfStock": true },
  ],
};

/**
 * The exact complement of {@link AVAILABLE_STOCK_QUERY}, so the two partitions
 * always sum to the unfiltered catalogue with nothing counted twice.
 */
export const UNAVAILABLE_STOCK_QUERY = { $nor: [AVAILABLE_STOCK_QUERY] };

/**
 * A copy of `query` narrowed to one stock partition. `$and` rather than a
 * top-level key because the caller's query may already carry its own `$or`
 * (a search clause, a vendor scope) that a bare merge would clobber.
 */
export function withStockConstraint(
  query: Record<string, unknown>,
  constraint: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...query,
    $and: [...((query.$and as Record<string, unknown>[]) || []), constraint],
  };
}

/**
 * Aggregation-expression twin of {@link AVAILABLE_STOCK_QUERY}, for the one
 * thing a query document cannot do: order by availability. `$sort` needs a
 * field, and "is this buyable" is a condition over four of them — so a pipeline
 * computes it with this and sorts on the result.
 *
 * Must stay in step with the query above and with the helpers at the top of
 * this file. `$ifNull` guards the one real difference between the two dialects:
 * the query operator `{ stock: { $gt: 0 } }` skips a document whose `stock` is
 * missing, while the aggregation `$gt` would compare `null` against `0` by BSON
 * type order instead.
 */
export const AVAILABLE_STOCK_EXPR = {
  $or: [
    { $gt: [{ $ifNull: ["$stock", 0] }, 0] },
    { $eq: ["$shipping.isPhysicalProduct", false] },
    { $eq: ["$inventory.tracked", false] },
    { $eq: ["$inventory.continueSellingWhenOutOfStock", true] },
  ],
};
