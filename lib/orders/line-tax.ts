/**
 * The tax each of an order's lines carried.
 *
 * A line taxed at its own rate records `taxRate`, `tax` and `taxParts`. The
 * consignment lines (lib/orders/order-vendors.ts) have always recorded them;
 * the order's own lines only do since checkouts started copying them over, so
 * an order placed before that holds the figures on its consignments alone.
 * Readers that take them per line — a return handing back exactly the tax a
 * line was charged, an invoice printing it — read them through here.
 *
 * Pure, with no imports, so the invoice builder and the return planner share it.
 */

interface TaxedLine {
  productId?: unknown;
  variantId?: unknown;
  quantity?: number | null;
  taxRate?: number | null;
  tax?: number | null;
  taxParts?: ReadonlyArray<unknown> | null;
}

const idOf = (value: unknown) => String((value as { _id?: unknown } | null)?._id ?? value ?? "");

const recordsTax = (line: TaxedLine) =>
  typeof line.tax === "number" || typeof line.taxRate === "number" || Boolean(line.taxParts?.length);

/**
 * `items` with each line's recorded tax filled in from the consignment lines
 * wherever the line has none of its own. A consignment line is matched by
 * product, variant and quantity (any quantity if none agrees) and used once.
 * A line that records its own tax is returned as it is.
 */
export function withRecordedLineTax<T extends TaxedLine>(
  items: ReadonlyArray<T>,
  subOrders: ReadonlyArray<{ items?: ReadonlyArray<TaxedLine> | null } | null | undefined> | null | undefined,
): T[] {
  const pool = (subOrders || []).flatMap((sub) => (sub?.items || []) as TaxedLine[]).filter(recordsTax);
  if (pool.length === 0) return [...items];
  const used = new Set<TaxedLine>();
  return items.map((item) => {
    if (recordsTax(item)) return item;
    const same = (line: TaxedLine) =>
      !used.has(line) &&
      idOf(line.productId) === idOf(item.productId) &&
      idOf(line.variantId) === idOf(item.variantId);
    const match =
      pool.find((line) => same(line) && Number(line.quantity) === Number(item.quantity)) ?? pool.find(same);
    if (!match) return item;
    used.add(match);
    return {
      ...item,
      ...(typeof match.taxRate === "number" ? { taxRate: match.taxRate } : {}),
      ...(typeof match.tax === "number" ? { tax: match.tax } : {}),
      ...(match.taxParts?.length ? { taxParts: match.taxParts } : {}),
    };
  });
}
