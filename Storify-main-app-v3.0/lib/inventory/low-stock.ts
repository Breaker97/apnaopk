import { PRODUCT_STATUS } from "@/config/app.config";
import { productTracksStock, type StockPolicySource } from "@/lib/products/stock-policy";

/**
 * What "low on stock" means, once: the alert a sale sends when it takes a
 * product down to this many units (lib/inventory/inventory.ts), the business
 * app's Home tile, and its product list's `lowStock` filter count the same
 * products, so the tile's number is the length of the list it opens.
 *
 * A product is low when it is on sale (active or unlisted: a draft sells
 * nothing), its stock means something (stock-policy.ts: not digital, quantity
 * tracked) and its units, every variant together, are at or below the
 * threshold. Zero and below count: the alert fires on the way down to them.
 */

/** At or below this many units a product is low on stock (D-B5: the alert's number). */
export const LOW_STOCK_THRESHOLD = 10;

const ON_SALE = [PRODUCT_STATUS.ACTIVE, PRODUCT_STATUS.UNLISTED];

/** The products low on stock, as a MongoDB filter. Combine it with the caller's scope. */
export function lowStockProductMatch(): Record<string, unknown> {
  return {
    status: { $in: ON_SALE },
    "shipping.isPhysicalProduct": { $ne: false },
    "inventory.tracked": { $ne: false },
    stock: { $lte: LOW_STOCK_THRESHOLD },
  };
}

/** The same decision for one product already read. */
export function isLowStock(
  product: StockPolicySource & { status?: string | null; stock?: number | null },
): boolean {
  return (
    (ON_SALE as readonly string[]).includes(String(product.status ?? "")) &&
    productTracksStock(product) &&
    Number(product.stock ?? 0) <= LOW_STOCK_THRESHOLD
  );
}
