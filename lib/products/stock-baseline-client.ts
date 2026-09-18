/**
 * The client half of `lib/products/stock-baseline.ts`: the stock numbers a
 * product form loaded, in the shape the update route merges against. Kept
 * apart so the form does not pull the server module's database imports.
 */

export type StockBaseline = {
  stock?: number;
  locationInventory?: Record<string, number>;
  variants?: Record<
    string,
    { stock?: number; locationInventory?: Record<string, number> }
  >;
};

type RawRows = Array<{ locationId?: unknown; quantity?: unknown }> | undefined;

function rowsToRecord(rows: RawRows): Record<string, number> {
  const record: Record<string, number> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.locationId) continue;
    record[String(row.locationId)] =
      typeof row.quantity === "number" ? row.quantity : 0;
  }
  return record;
}

export function buildStockBaseline(product: {
  stock?: unknown;
  locationInventory?: RawRows;
  variants?: Array<{ _id?: unknown; stock?: unknown; locationInventory?: RawRows }>;
}): StockBaseline {
  const variants: NonNullable<StockBaseline["variants"]> = {};
  for (const variant of Array.isArray(product.variants) ? product.variants : []) {
    if (!variant?._id) continue;
    variants[String(variant._id)] = {
      stock: typeof variant.stock === "number" ? variant.stock : 0,
      locationInventory: rowsToRecord(variant.locationInventory),
    };
  }
  return {
    stock: typeof product.stock === "number" ? product.stock : 0,
    locationInventory: rowsToRecord(product.locationInventory),
    variants,
  };
}
