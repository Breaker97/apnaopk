import {
  getPOSLocationStock,
  type POSLocationInventory,
} from "@/lib/pos/product-stock";
import { productAllowsOversell } from "@/lib/products/stock-policy";
import type { POSOrderItemInput } from "@/lib/pos/order-totals";

/**
 * Which lines of a replayed offline sale the shelf could not actually cover.
 *
 * Measured before the decrement, because afterwards the counter has already
 * gone negative and the shortfall is indistinguishable from a counting error.
 * The result is stamped on the order (`posOversoldLines`) and reported to the
 * merchant: the sale itself is never refused — the goods left the shop while
 * the register was offline — but somebody has to be told which shelf is now
 * short, or the discrepancy surfaces weeks later as an unexplained variance.
 *
 * A product whose own policy already permits overselling (digital goods,
 * "continue selling when out of stock", untracked inventory) is not reported:
 * going below zero there is the merchant's standing intention, not news.
 */

export interface POSOversoldLine {
  productId: string;
  variantId?: string;
  name: string;
  /** Units this sale needed. */
  requested: number;
  /** Units the register's location actually had. Can already be negative. */
  available: number;
}

type StockSource = {
  _id?: unknown;
  name?: string;
  price?: number;
  stock?: number;
  locationInventory?: POSLocationInventory[];
  variants?: Array<{
    _id: unknown;
    name?: string;
    stock?: number;
    locationInventory?: POSLocationInventory[];
  }>;
  shipping?: { isPhysicalProduct?: boolean };
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
};

/**
 * `locationId` is a hard scope for POS, exactly as it is in `decrementInventory`:
 * the register stands in one shop and sells what is physically there, so a
 * warehouse across town holding plenty does not make this line covered.
 */
function availableFor(
  product: StockSource,
  variantId: string | undefined,
  locationId: string | undefined,
): number {
  if (variantId) {
    const variant = (product.variants || []).find(
      (candidate) => String(candidate._id) === String(variantId),
    );
    if (!variant) return 0;
    return locationId
      ? getPOSLocationStock(variant.locationInventory, locationId)
      : (variant.stock ?? 0);
  }

  return locationId
    ? getPOSLocationStock(product.locationInventory, locationId)
    : (product.stock ?? 0);
}

export function findOversoldLines(
  items: POSOrderItemInput[],
  productById: Map<string, StockSource>,
  locationId: string | undefined,
): POSOversoldLine[] {
  const oversold: POSOversoldLine[] = [];

  // Several lines can name the same product+variant (a scan repeated, a
  // manual quantity edit). They draw from one counter, so they are judged
  // against one figure rather than each on its own.
  const needed = new Map<string, number>();
  for (const item of items) {
    const key = `${String(item.productId).trim()}:${item.variantId ? String(item.variantId) : ""}`;
    needed.set(key, (needed.get(key) || 0) + (Number(item.quantity) || 0));
  }

  for (const [key, requested] of needed) {
    const [productId, variantId] = key.split(":");
    const product = productById.get(productId);
    if (!product) continue;
    // The merchant already said this one may go below zero.
    if (productAllowsOversell(product)) continue;

    const available = availableFor(product, variantId || undefined, locationId);
    if (available >= requested) continue;

    const variant = variantId
      ? (product.variants || []).find(
          (candidate) => String(candidate._id) === String(variantId),
        )
      : undefined;

    oversold.push({
      productId,
      variantId: variantId || undefined,
      name: variant?.name
        ? `${product.name ?? "Product"} — ${variant.name}`
        : (product.name ?? "Product"),
      requested,
      available,
    });
  }

  return oversold;
}
