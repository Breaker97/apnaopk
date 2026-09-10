import {
  getPurchasableQuantity,
  productAllowsOversell,
  type StockPolicySource,
} from "@/lib/products/stock-policy";

export type POSLocationInventory = { locationId?: string; quantity?: number };

export type POSProductWithInventory = {
  stock?: number;
  locationInventory?: POSLocationInventory[];
  variants?: POSVariantWithInventory[];
};

type POSVariantWithInventory = {
  stock?: number;
  locationInventory?: POSLocationInventory[];
};

export type POSStockStatusFilter = "all" | "in_stock" | "out_of_stock";

/**
 * The units of a selection held at one location.
 *
 * Two different situations both arrive here as "no row for this location", and
 * they mean opposite things:
 *
 *   - **The product records stock per location, just not at this one.** It
 *     genuinely holds nothing here, so the register must read 0 — that is the
 *     whole point of running a location-aware counter.
 *   - **The product records no locations at all** (`locationInventory` empty or
 *     missing). Its units live in `stock` alone, which is how every product
 *     created before locations existed — and every one saved through a form
 *     with no location configured — stores them. Reading 0 for those turns the
 *     entire catalogue "out of stock" the moment a default POS location is
 *     picked, no matter how much stock the merchant entered.
 *
 * So an EMPTY list falls back to the aggregate; a populated list that simply
 * lacks this location does not.
 */
export function getPOSLocationStock(
  inventory: POSLocationInventory[] | undefined,
  locationId: string,
  fallbackStock: number | undefined = 0,
): number {
  if (!Array.isArray(inventory) || inventory.length === 0) {
    return Math.max(0, Number(fallbackStock) || 0);
  }
  return inventory.find((item) => item.locationId === locationId)?.quantity ?? 0;
}

export function applyPOSLocationStock<TProduct extends POSProductWithInventory>(
  product: TProduct,
  locationId: string,
): TProduct {
  if (!locationId) return product;

  if (Array.isArray(product.variants) && product.variants.length > 0) {
    const variants = product.variants.map((variant) => ({
      ...variant,
      stock: getPOSLocationStock(
        variant.locationInventory,
        locationId,
        variant.stock,
      ),
    }));
    const stock = variants.reduce((sum, variant) => sum + (variant.stock || 0), 0);
    return { ...product, variants, stock };
  }

  return {
    ...product,
    stock: getPOSLocationStock(
      product.locationInventory,
      locationId,
      product.stock,
    ),
  };
}

function getPOSAvailableStock(product: POSProductWithInventory): number {
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    return product.variants.reduce((sum, variant) => sum + (variant.stock || 0), 0);
  }
  return product.stock || 0;
}

/**
 * How many units of a selection the register may still ring up. Digital
 * products and "track quantity: off" both sit at `stock === 0` on purpose, so
 * the raw count decides nothing on its own — `getPurchasableQuantity` owns that
 * rule for every surface, the counter included.
 */
export function getPOSPurchasableQuantity(
  product: (POSProductWithInventory & StockPolicySource) | null | undefined,
  stock: number | null | undefined,
): number {
  return getPurchasableQuantity(product, stock);
}

/** Whether the register may sell this product at all right now. */
export function isPOSProductSellable(
  product: POSProductWithInventory & StockPolicySource,
): boolean {
  if (productAllowsOversell(product)) return true;
  return getPOSAvailableStock(product) > 0;
}

export function matchesPOSStockStatus(
  product: POSProductWithInventory & StockPolicySource,
  stockStatus: POSStockStatusFilter,
): boolean {
  if (stockStatus === "all") return true;
  const sellable = isPOSProductSellable(product);
  return stockStatus === "in_stock" ? sellable : !sellable;
}
