import { quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import { calculatePOSOrderTotals } from "@/lib/pos/order-totals";
import type { ReceiptPrintPayload } from "@/lib/pos/receipt-html";

/**
 * What a POS receipt says about the money, worked out from the sale's own
 * figures, so the paper reconciles:
 *
 *   Sub Total − Discount + Tax (added) = TOTAL
 *
 * The sub total is the goods at their marked prices (each line's amount is
 * its price × quantity), and the discount is every markdown on the sale, the
 * line discounts and the sale discount together — the figures the order
 * itself stores (`subtotal`, `discount`). Tax inside the prices is printed for
 * information and not added; an exempt sale prints the tax it was spared,
 * which comes off. See `receiptPrintedTotal`.
 */

type SaleTotals = Pick<
  ReturnType<typeof calculatePOSOrderTotals>,
  "subtotal" | "totalDiscount" | "tax" | "includedTax" | "total" | "inclusive" | "exempt"
>;

export interface SaleReceiptLine {
  name: string;
  variantName?: string;
  price: number;
  quantity: number;
}

/** The receipt for a sale just rung up at the till. */
export function saleReceiptPayload(input: {
  orderNumber: string;
  createdAt: string | Date;
  locationName?: string;
  lines: ReadonlyArray<SaleReceiptLine>;
  /** `calculatePOSOrderTotals` for the cart: the sum the sale was charged at. */
  totals: SaleTotals;
  taxExemptReason?: string;
  /** The tenders as `checkPOSTenders` accepted them. */
  tenders: ReadonlyArray<{ method: string; amount: number; tendered?: number }>;
  change: number;
  balanceDue: number;
  /** A tender's name at the till. */
  tenderLabel: (method: string) => string;
  /** What a sale paid in more than one way is called. */
  splitLabel: string;
}): ReceiptPrintPayload {
  const { totals } = input;
  const taxMode: ReceiptPrintPayload["taxMode"] = totals.exempt
    ? "exempt"
    : totals.inclusive
      ? "included"
      : "added";
  const cashTendered = input.tenders
    .filter((tender) => tender.method === "cash")
    .reduce((sum, tender) => sum + (tender.tendered ?? tender.amount), 0);
  return {
    orderNumber: input.orderNumber,
    createdAt: input.createdAt,
    locationName: input.locationName,
    paymentMethod:
      input.tenders.length > 1 ? input.splitLabel : input.tenderLabel(input.tenders[0]?.method ?? ""),
    payments: input.tenders.map((tender) => ({
      label: input.tenderLabel(tender.method),
      amount: tender.amount,
    })),
    cashTendered: cashTendered > 0 ? cashTendered : undefined,
    items: input.lines.map((line) => ({
      name: line.variantName ? `${line.name} ${line.variantName}` : line.name,
      quantity: line.quantity,
      price: line.price,
      amount: roundMoney(line.price * line.quantity),
    })),
    subtotal: totals.subtotal,
    // Exempt with tax-inclusive prices: the tax inside them, which came off.
    tax: taxMode === "exempt" ? totals.includedTax : totals.tax,
    taxMode,
    taxExemptReason: input.taxExemptReason,
    discount: totals.totalDiscount,
    total: totals.total,
    balanceReturned: input.change,
    balanceDue: input.balanceDue > 0 ? input.balanceDue : undefined,
  };
}

/**
 * The total a reader works out from the receipt's own lines: the sub total,
 * less the discount, plus tax added on top, less tax an exempt sale was
 * spared. Equal to `total` on every receipt the till prints.
 */
export function receiptPrintedTotal(receipt: Pick<ReceiptPrintPayload, "subtotal" | "discount" | "tax" | "taxMode">): number {
  const mode = receipt.taxMode ?? "added";
  const tax = mode === "added" ? receipt.tax : mode === "exempt" ? -receipt.tax : 0;
  return roundMoney(receipt.subtotal - receipt.discount + tax);
}

/** A counter sale as the order stores it: what a reprint is built from. */
export interface StoredPOSSale {
  subtotal?: number | null;
  discount?: number | null;
  tax?: number | null;
  total?: number | null;
  currency?: string | null;
  /** Rung up at tax-inclusive shelf prices, stored net of tax. */
  pricesIncludeTax?: boolean | null;
  taxExemption?: { reason?: string | null } | null;
  /** The sale discount as the cashier entered it. */
  discountMeta?: { type?: "percent" | "amount" | null; value?: number | null } | null;
  items?: ReadonlyArray<{
    name: string;
    quantity: number;
    price: number;
    /** Percent; recorded on every line of a tax-inclusive sale. */
    taxRate?: number | null;
    lineDiscount?: { type?: "percent" | "amount" | null; value?: number | null; amount?: number | null } | null;
  }>;
  posTenders?: ReadonlyArray<{ method: string; amount: number; tendered?: number | null; change?: number | null; kind?: string | null }>;
}

/** The money half of a reprinted receipt. */
export type StoredSaleReceipt = Pick<
  ReceiptPrintPayload,
  "items" | "subtotal" | "discount" | "tax" | "taxMode" | "taxExemptReason" | "total" | "cashTendered" | "balanceReturned"
>;

/**
 * The receipt figures of a sale already written down, for printing it again:
 * the same Sub Total, Discount, Tax and TOTAL the customer was handed.
 *
 * A tax-exclusive sale is stored as rung up, so its figures are read back.
 * A tax-inclusive one is stored net of tax (`posStoredSale`); its shelf prices
 * are rebuilt from each line's recorded rate and the sale summed again, and
 * used when that comes back to the stored total. When it doesn't (a sale from
 * before the rates were recorded), the stored net figures print instead, the
 * tax shown on top: different from the original paper, but still adding up.
 */
export function storedSaleReceipt(order: StoredPOSSale): StoredSaleReceipt {
  const currency = order.currency || "USD";
  const items = order.items ?? [];
  const exempt = Boolean(order.taxExemption);
  const total = Number(order.total) || 0;
  const saleTenders = (order.posTenders ?? []).filter((tender) => tender.kind !== "balance");
  const cashTendered = saleTenders
    .filter((tender) => tender.method === "cash")
    .reduce((sum, tender) => sum + (tender.tendered ?? tender.amount), 0);
  const tenderFigures = {
    total,
    taxExemptReason: order.taxExemption?.reason || undefined,
    cashTendered: cashTendered > 0 ? roundMoney(cashTendered) : undefined,
    balanceReturned: roundMoney(saleTenders.reduce((sum, tender) => sum + (tender.change || 0), 0)),
  };

  if (order.pricesIncludeTax && items.length > 0 && items.every((item) => typeof item.taxRate === "number")) {
    const shelf = (value: number, rate: number) => quantizeToCurrency(value * (1 + rate), currency);
    const lines = items.map((item) => {
      const rate = Number(item.taxRate) / 100;
      const lineDiscount = item.lineDiscount?.type
        ? {
            type: item.lineDiscount.type,
            value:
              item.lineDiscount.type === "amount"
                ? shelf(Number(item.lineDiscount.value) || 0, rate)
                : Number(item.lineDiscount.value) || 0,
          }
        : undefined;
      return {
        productId: "",
        name: item.name,
        sku: "",
        vendorId: "",
        price: shelf(item.price, rate),
        quantity: item.quantity,
        taxRate: rate,
        ...(lineDiscount ? { lineDiscount } : {}),
      };
    });
    const meta = order.discountMeta;
    const totals = calculatePOSOrderTotals({
      items: lines,
      discount:
        meta?.type && Number(meta.value) > 0
          ? { type: meta.type, value: Number(meta.value), amount: 0 }
          : undefined,
      pricesIncludeTax: true,
      taxExempt: exempt,
      currency,
    });
    const agrees =
      Math.abs(totals.total - total) < 0.005 && (exempt || Math.abs(totals.tax - (Number(order.tax) || 0)) < 0.005);
    if (agrees) {
      return {
        ...tenderFigures,
        items: lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          price: line.price,
          amount: roundMoney(line.price * line.quantity),
        })),
        subtotal: totals.subtotal,
        discount: totals.totalDiscount,
        tax: totals.includedTax,
        taxMode: exempt ? "exempt" : "included",
      };
    }
  }

  const receiptItems = items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    amount: roundMoney(item.price * item.quantity),
  }));
  const tax = exempt ? 0 : Number(order.tax) || 0;
  const subtotal =
    typeof order.subtotal === "number"
      ? order.subtotal
      : roundMoney(receiptItems.reduce((sum, item) => sum + item.amount, 0));
  let discount = Number(order.discount) || 0;
  // Whatever the stored discount says, the paper has to add up.
  if (receiptPrintedTotal({ subtotal, discount, tax, taxMode: "added" }) !== roundMoney(total)) {
    discount = Math.max(0, roundMoney(subtotal + tax - total));
  }
  return {
    ...tenderFigures,
    items: receiptItems,
    subtotal,
    discount,
    tax,
    taxMode: exempt ? "exempt" : "added",
  };
}

/** A sale found again at the till (`searchPOSSales`), printed once more. */
export function reprintReceiptPayload(
  sale: {
    orderNumber: string;
    createdAt: string;
    balanceDue: number;
    tenders: ReadonlyArray<{ method: string; amount: number }>;
    receipt: StoredSaleReceipt & { locationName?: string };
  },
  labels: { tenderLabel: (method: string) => string; splitLabel: string },
): ReceiptPrintPayload {
  const { locationName, ...money } = sale.receipt;
  return {
    ...money,
    orderNumber: sale.orderNumber,
    createdAt: sale.createdAt,
    // The counter the sale was rung up at, not the one reprinting it.
    locationName,
    paymentMethod:
      sale.tenders.length > 1 ? labels.splitLabel : labels.tenderLabel(sale.tenders[0]?.method ?? ""),
    payments: sale.tenders.map((tender) => ({ label: labels.tenderLabel(tender.method), amount: tender.amount })),
    balanceDue: sale.balanceDue > 0 ? sale.balanceDue : undefined,
  };
}
