import { allocateMoney, quantizeToCurrency } from "@/lib/intl/money";

/**
 * Sales tax, worked out line by line.
 *
 * A store has one rate (Settings → Orders) that every line used to be taxed
 * at. A product or its category may now set its own (lib/tax/tax-rates.ts),
 * 0 selling it tax-free, so a basket is taxed per line: each line's share of
 * any order-wide discount comes off it first — tax is charged on what the
 * shopper pays — then its own rate applies.
 *
 * Prices may also already include the tax (the till's shelf prices, Settings
 * → POS). Then the tax is the part of each line's price that is tax:
 * `price − price / (1 + rate)`, and nothing is added on top.
 *
 * Pure and client-safe: the cart, checkout, the till and every server path
 * that prices an order agree because they all call this.
 */

export interface TaxLine {
  /** What the line sells for before any order-wide discount. */
  amount: number;
  /** The line's rate, as a fraction (0.08 is 8%). */
  rate: number;
  /**
   * This line's own share of the order-wide discount, when the caller knows it
   * (a coupon limited to some products). Absent, the discount is shared by
   * what each line sells for.
   */
  discount?: number;
}

export interface TaxResult {
  /** The tax on the whole basket, in what the currency can hold. */
  tax: number;
  /** Each line's tax; they add up to `tax`. */
  lineTaxes: number[];
  /** Each line's share of the order-wide discount. */
  lineDiscounts: number[];
  inclusive: boolean;
}

const positive = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

export function computeTax(params: {
  lines: TaxLine[];
  /** The order-wide discount on goods (a coupon, the till's sale discount). */
  discount?: number;
  /** Prices already include the tax. */
  inclusive?: boolean;
  currency: string;
}): TaxResult {
  const currency = params.currency || "USD";
  const q = (value: number) => quantizeToCurrency(value, currency);
  const inclusive = Boolean(params.inclusive);
  const amounts = params.lines.map((line) => q(positive(line.amount)));
  const goods = q(amounts.reduce((sum, value) => sum + value, 0));
  const discount = Math.min(goods, q(positive(params.discount)));

  const named = params.lines.every((line) => typeof line.discount === "number");
  const lineDiscounts = named
    ? params.lines.map((line, index) => Math.min(amounts[index]!, q(positive(line.discount))))
    : discount > 0
      ? allocateMoney(discount, amounts, currency)
      : amounts.map(() => 0);

  const raw = params.lines.map((line, index) => {
    const base = Math.max(0, amounts[index]! - lineDiscounts[index]!);
    const rate = positive(line.rate);
    return inclusive ? base - base / (1 + rate) : base * rate;
  });
  const tax = q(raw.reduce((sum, value) => sum + value, 0));
  const lineTaxes = tax > 0 ? allocateMoney(tax, raw, currency) : raw.map(() => 0);
  return { tax, lineTaxes, lineDiscounts, inclusive };
}

/** Whether lines carry more than the one store rate — worth recording per line. */
export function linesHaveOwnRates(lines: ReadonlyArray<Pick<TaxLine, "rate">>, storeRate: number): boolean {
  return lines.some((line) => Math.abs(positive(line.rate) - positive(storeRate)) > 1e-9);
}

/**
 * The tax lines of a bag the browser holds: each line carries its product's
 * own rate when it has one (the cart read attaches it, lib/cart). Null when
 * none does, so the store's one rate applies as before.
 */
export function cartTaxLines(
  items: ReadonlyArray<{ price: number; quantity: number; taxRate?: number | null }>,
  storeRate: number,
): TaxLine[] | null {
  if (!items.some((item) => typeof item.taxRate === "number")) return null;
  return items.map((item) => ({
    amount: positive(item.price) * positive(item.quantity),
    rate: typeof item.taxRate === "number" ? item.taxRate : positive(storeRate),
  }));
}
