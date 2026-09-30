/**
 * Editing an inventory row's Available or On hand — the two are one number.
 *
 * On hand is Available + Committed + Unavailable (see
 * `lib/inventory/stock-breakdown.ts`), and only Available is stored: committed
 * units belong to orders and unavailable ones to returns. So typing either field
 * sets the same stock, and the other follows. A save sends the change as an
 * adjustment rather than the new total: a sale landing between loading the page
 * and saving it is kept, and with a location filter the change lands on that
 * location instead of overwriting its count with the store-wide figure.
 *
 * Pure and client-safe.
 */

type StockEditRow = {
  available: number;
  committed: number;
  unavailable: number;
  onHand: number;
};

export type StockEditField = "available" | "onHand";

/**
 * The stock under a row's figures. Read back from On hand rather than
 * Available, which is floored at zero: a product that oversells stores a
 * negative stock, and an edit has to start from the real one.
 */
export function currentStock(row: StockEditRow): number {
  return row.onHand - row.committed - row.unavailable;
}

/** The stock an edit of `field` to `value` asks for. Never below zero. */
export function targetStockForEdit(
  row: StockEditRow,
  field: StockEditField,
  value: number,
): number {
  const typed = Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0));
  return field === "available"
    ? typed
    : Math.max(0, typed - row.committed - row.unavailable);
}

/** What the row reads while the edit is unsaved. */
export function figuresForStock(
  row: StockEditRow,
  stock: number,
): Pick<StockEditRow, "available" | "onHand"> {
  return {
    available: Math.max(0, stock),
    onHand: Math.max(0, stock + row.committed + row.unavailable),
  };
}

/** The adjustment a save sends for this row; 0 means nothing to save. */
export function stockAdjustment(row: StockEditRow, stock: number): number {
  return stock - currentStock(row);
}
