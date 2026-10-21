import {
  computeLineDiscountAmount,
} from "@/lib/orders/line-discount";
import { quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import { computeTax, linesHaveOwnRates } from "@/lib/tax/tax-engine";

export type POSOrderItemInput = {
  productId: string;
  variantId?: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  image?: string;
  vendorId: string;
  lineTotal?: number;
  lineDiscount?: {
    type: "percent" | "amount";
    value: number;
    amount?: number;
  };
  lineNote?: string;
};

export type POSOrderDiscountInput = {
  type: "percent" | "amount";
  value: number;
  amount: number;
  reason?: string;
  note?: string;
};

export function computePOSLineDiscountAmount(
  item: POSOrderItemInput,
  /** The store currency — see `computeLineDiscountAmount`. */
  currency?: string | null,
): number {
  if (!item.lineDiscount) return 0;
  return computeLineDiscountAmount(
    item.price || 0,
    item.quantity || 0,
    item.lineDiscount,
    currency,
  );
}

/** Whether a sale carries any discount, on a line or on the whole sale. */
export function posSaleHasDiscount(params: {
  items: Array<Pick<POSOrderItemInput, "lineDiscount">>;
  discount?: Pick<POSOrderDiscountInput, "value"> | null;
}): boolean {
  return (
    Number(params.discount?.value || 0) > 0 ||
    params.items.some((item) => Number(item.lineDiscount?.value || 0) > 0)
  );
}

/**
 * The sale's money — the one sum the till's screen, the card intent and the
 * order route all work it out with.
 *
 * Tax is charged on what the shopper actually pays — after the line discounts
 * AND the sale discount — the way online checkout charges it, each line at its
 * own rate where its product or category sets one (`item.taxRate`, resolved
 * by lib/tax/tax-rates.ts), else the store's.
 *
 * With `pricesIncludeTax` (Settings → POS) the shelf prices already contain
 * the tax: the total is what the shelf says, and `tax` is the part of it that
 * is tax. A tax-exempt sale charges none — and with tax-inclusive prices, the
 * tax inside them comes off the total.
 *
 * The discount comes from its type and value only. The terminal's own figure
 * used to be taken whenever it was within 0.5 of the computed one, which let a
 * client nudge every sale's discount.
 */
export function calculatePOSOrderTotals(params: {
  items: Array<POSOrderItemInput & { taxRate?: number | null }>;
  discount?: POSOrderDiscountInput;
  /** The store's rate, a fraction (`settings.orders.taxRate`). */
  taxRate?: number;
  pricesIncludeTax?: boolean;
  taxExempt?: boolean;
  /**
   * The store currency, which line discounts are rounded to — the same
   * rounding the sale's consignments record them at.
   */
  currency?: string | null;
}) {
  const currency = params.currency || "USD";
  const subtotal = roundMoney(
    params.items.reduce(
      (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
      0,
    ),
  );
  const lineDiscounts = params.items.map((item) => computePOSLineDiscountAmount(item, currency));
  const lineDiscountTotal = roundMoney(lineDiscounts.reduce((sum, value) => sum + value, 0));
  const discountedSubtotal = Math.max(0, roundMoney(subtotal - lineDiscountTotal));
  const shippingCost = 0;

  let discountAmount = 0;
  const discount = params.discount;
  if (discount && typeof discount === "object" && discount.value > 0) {
    discountAmount =
      discount.type === "percent"
        ? (discountedSubtotal * Math.min(discount.value, 100)) / 100
        : discount.value;
    discountAmount = Math.max(0, Math.min(roundMoney(discountAmount), discountedSubtotal));
  }

  const storeRate = Math.max(0, Number(params.taxRate) || 0);
  const lineRates = params.items.map((item) =>
    typeof item.taxRate === "number" ? Math.max(0, item.taxRate) : storeRate,
  );
  const inclusive = Boolean(params.pricesIncludeTax);
  const worked = computeTax({
    lines: params.items.map((item, index) => ({
      amount: Math.max(0, (item.price || 0) * (item.quantity || 0) - lineDiscounts[index]!),
      rate: lineRates[index]!,
    })),
    discount: discountAmount,
    inclusive,
    currency,
  });
  const exempt = Boolean(params.taxExempt);
  const tax = exempt ? 0 : worked.tax;
  const lineTaxes = exempt ? worked.lineTaxes.map(() => 0) : worked.lineTaxes;
  // What the shopper pays for the goods: tax-inclusive prices as marked.
  const taxable = Math.max(0, roundMoney(discountedSubtotal - discountAmount));
  const totalDiscount = roundMoney(lineDiscountTotal + discountAmount);
  const total = inclusive
    ? Math.max(0, roundMoney(taxable - (exempt ? worked.tax : 0)))
    : Math.max(0, roundMoney(taxable + tax));

  return {
    subtotal,
    lineDiscountTotal,
    discountedSubtotal,
    tax,
    shippingCost,
    discountAmount,
    totalDiscount,
    total,
    /** Each line's rate (fraction) and tax; the taxes add up to `tax`. */
    lineRates,
    lineTaxes,
    /** Each line's share of the sale discount. */
    lineSaleDiscounts: worked.lineDiscounts,
    /** The tax inside tax-inclusive prices (0 when prices exclude it). */
    includedTax: inclusive ? worked.tax : 0,
    inclusive,
    exempt,
    /** Whether any line was taxed at a rate other than the store's. */
    hasOwnRates: linesHaveOwnRates(lineRates.map((rate) => ({ rate })), storeRate),
  };
}

/** One line as the order stores it. */
export interface POSStoredLine {
  /** Unit price — net of tax for a tax-inclusive sale. */
  price: number;
  lineDiscount?: { type: "percent" | "amount"; value: number; amount: number };
}

/**
 * How a sale is written to the order.
 *
 * A tax-exclusive sale is written as rung up. A tax-inclusive one is written
 * net of tax — each line's price and markdown without the tax inside them,
 * the tax on its own — so `subtotal − discount + tax = total` holds and every
 * reader built on it (refunds, the ledger, payouts and commission, which is
 * taken on the goods, not the tax) works unchanged. The receipt the shopper
 * holds keeps the shelf prices; the order says `pricesIncludeTax`.
 */
export function posStoredSale(
  items: Array<POSOrderItemInput & { taxRate?: number | null }>,
  totals: ReturnType<typeof calculatePOSOrderTotals>,
  currency?: string | null,
): { lines: POSStoredLine[]; subtotal: number; discount: number } {
  const code = currency || "USD";
  const lineDiscountOf = (item: POSOrderItemInput) => computePOSLineDiscountAmount(item, code);
  if (!totals.inclusive) {
    return {
      lines: items.map((item) => ({
        price: item.price,
        ...(item.lineDiscount
          ? { lineDiscount: { type: item.lineDiscount.type, value: item.lineDiscount.value, amount: lineDiscountOf(item) } }
          : {}),
      })),
      subtotal: totals.subtotal,
      discount: totals.totalDiscount,
    };
  }
  const net = (value: number, index: number) => value / (1 + totals.lineRates[index]!);
  const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
  const lines = items.map((item, index) => {
    const amount = lineDiscountOf(item);
    return {
      price: round6(net(item.price, index)),
      ...(item.lineDiscount
        ? {
            lineDiscount: {
              type: item.lineDiscount.type,
              value: item.lineDiscount.type === "amount" ? round6(net(item.lineDiscount.value, index)) : item.lineDiscount.value,
              amount: quantizeToCurrency(net(amount, index), code),
            },
          }
        : {}),
    };
  });
  const subtotal = quantizeToCurrency(
    lines.reduce((sum, line, index) => sum + line.price * (items[index]!.quantity || 0), 0),
    code,
  );
  // Whatever makes `subtotal − discount + tax` the total the shopper paid.
  const discount = Math.max(0, quantizeToCurrency(subtotal + totals.tax - totals.total, code));
  return { lines, subtotal, discount };
}
