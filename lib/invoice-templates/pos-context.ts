/**
 * `buildPosContext` (docs/INVOICE_TEMPLATE_BUILDER.md §4.7.1): the render
 * context for a receipt at the till, online or offline, from the same inputs
 * the legacy receipt is built from (`saleReceiptPayload`, Phase 0):
 *
 *   - the cart lines as rung up (shelf prices)
 *   - `calculatePOSOrderTotals` for the cart: the sum the sale was charged at
 *   - the tenders as `checkPOSTenders` accepted them, the change and any
 *     balance a deposit leaves
 *   - the till's settings (store identity, currency), the counter, the
 *     cashier and the customer, when one was chosen
 *
 * The money follows the receipt rule, so the paper reconciles:
 * Sub Total (marked prices) − Discount (line + sale) + Tax (added) = TOTAL.
 * Tax inside the prices is information only; an exempt sale shows the tax it
 * was spared. Paid is what the tenders paid (change is not payment), due is
 * the deposit's balance, and there is never cash to collect at the door.
 *
 * Client-safe: no model or server import, so the offline till can run it.
 */
import { calculatePOSOrderTotals, computePOSLineDiscountAmount, type POSOrderItemInput } from "@/lib/pos/order-totals";
import { quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import type { ContextItem, ContextTaxMode, PrintContext } from "./context-types";
import type { TemplateLocale } from "./types";

type SaleTotals = Pick<
  ReturnType<typeof calculatePOSOrderTotals>,
  "subtotal" | "totalDiscount" | "tax" | "includedTax" | "total" | "inclusive" | "exempt"
>;

export interface PosContextLine extends POSOrderItemInput {
  variantName?: string;
  variantOptions?: Array<{ name: string; value: string }>;
  variantSku?: string;
  compareAtPrice?: number;
}

export interface PosContextInput {
  /** The receipt number: the order's, or the local one an offline sale prints. */
  orderNumber: string;
  createdAt: string | Date;
  lines: ReadonlyArray<PosContextLine>;
  /** `calculatePOSOrderTotals` for the cart. */
  totals: SaleTotals;
  taxExemptReason?: string;
  /** The tenders as `checkPOSTenders` accepted them. */
  tenders: ReadonlyArray<{ method: string; amount: number; tendered?: number }>;
  change: number;
  balanceDue: number;
  /** A tender's name at the till (`pos.pay.*`). */
  tenderLabel: (method: string) => string;
  settings: {
    currency: string;
    storeName?: string;
    storePhone?: string;
    storeEmail?: string;
    storeAddress?: string;
    storeDomain?: string;
    logoUrl?: string;
    /** "Sales tax permit 123-456789", the store's tax registration (Settings → Tax). */
    taxId?: string | null;
  };
  counterName?: string;
  cashierName?: string;
  customer?: { name?: string; phone?: string; email?: string } | null;
  locale?: TemplateLocale;
}

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const COLOUR_OPTION_NAMES = new Set(["color", "colour", "রং", "রঙ", "কালার"]);
const SIZE_OPTION_NAMES = new Set(["size", "সাইজ", "আকার"]);

function optionValue(line: PosContextLine, names: ReadonlySet<string>): string | null {
  const option = (line.variantOptions || []).find((entry) => names.has(String(entry?.name || "").trim().toLowerCase()));
  return text(option?.value);
}

function posItem(line: PosContextLine, currency: string): ContextItem {
  const unitPrice = Number(line.price) || 0;
  const qty = Number(line.quantity) || 0;
  const lineDiscount = computePOSLineDiscountAmount(line, currency);
  const compareAt = Number(line.compareAtPrice) || 0;
  return {
    name: String(line.name || "").trim(),
    variant: text(line.variantName),
    colour: optionValue(line, COLOUR_OPTION_NAMES),
    size: optionValue(line, SIZE_OPTION_NAMES),
    sku: text(line.variantSku) ?? text(line.sku),
    qty,
    unitPrice,
    compareAtPrice: compareAt > unitPrice ? compareAt : null,
    lineDiscount,
    lineTotal: quantizeToCurrency(Math.max(0, unitPrice * qty - lineDiscount), currency),
    image: text(line.image),
    weight: null,
    note: text(line.lineNote),
    // The till prints before the sale is saved, before each line's tax is
    // recorded; the saved sale's invoice carries it (lib/invoice-templates/context.ts).
    taxRate: null,
    tax: null,
    totalWithTax: null,
  };
}

export function buildPosContext(input: PosContextInput): PrintContext {
  const currency = String(input.settings.currency || "USD").toUpperCase();
  const locale: TemplateLocale = input.locale ?? "en";
  const { totals } = input;
  const taxMode: ContextTaxMode = totals.exempt ? "exempt" : totals.inclusive ? "included" : "added";
  const cashTendered = input.tenders
    .filter((tender) => tender.method === "cash")
    .reduce((sum, tender) => sum + (tender.tendered ?? tender.amount), 0);
  const paid = quantizeToCurrency(
    input.tenders.reduce((sum, tender) => sum + (Number(tender.amount) || 0), 0),
    currency,
  );
  const due = quantizeToCurrency(Math.max(0, Number(input.balanceDue) || 0), currency);
  const created = input.createdAt instanceof Date ? input.createdAt : new Date(input.createdAt);

  return {
    category: "pos",
    locale,
    isSample: false,
    store: {
      name: text(input.settings.storeName),
      phone: text(input.settings.storePhone),
      email: text(input.settings.storeEmail),
      address: text(input.settings.storeAddress),
      logo: text(input.settings.logoUrl),
      website: text(input.settings.storeDomain),
      facebook: null,
      taxId: text(input.settings.taxId),
    },
    order: {
      number: input.orderNumber,
      date: Number.isNaN(created.getTime()) ? null : created.toISOString(),
      paymentStatus: due > 0 ? "partially_paid" : "paid",
      paymentMethod: input.tenders.map((tender) => tender.method).join("+") || null,
      customerNote: null,
      internalNote: null,
      takenBy: text(input.cashierName),
      channel: "pos",
    },
    customer: {
      name: text(input.customer?.name),
      phone: text(input.customer?.phone),
      email: text(input.customer?.email),
      addressLines: [],
    },
    items: input.lines.map((line) => posItem(line, currency)),
    money: {
      currency,
      subtotal: totals.subtotal,
      discount: totals.totalDiscount,
      delivery: 0,
      // Exempt with tax-inclusive prices: the tax inside them, which came off.
      tax: taxMode === "exempt" ? totals.includedTax : totals.tax,
      taxMode,
      duty: 0,
      total: totals.total,
      paid,
      due,
      cod: 0,
      refunded: 0,
    },
    delivery: {
      method: null,
      courier: null,
      service: null,
      trackingNumber: null,
      trackingUrl: null,
      seller: null,
      labelSource: null,
    },
    pos: {
      counter: text(input.counterName),
      cashier: text(input.cashierName),
      tenders: input.tenders.map((tender) => ({
        label: input.tenderLabel(tender.method),
        amount: Number(tender.amount) || 0,
      })),
      cashTendered: cashTendered > 0 ? roundMoney(cashTendered) : null,
      change: input.change > 0 ? roundMoney(input.change) : null,
      taxExemptReason: text(input.taxExemptReason),
    },
    page: { number: 1, count: 1 },
    consignment: null,
  };
}

/**
 * The total a reader works out from the context's own figures: sub total,
 * less the discount, plus tax added on top, less tax an exempt sale was
 * spared. Equal to `money.total` on every receipt context.
 */
export function posPrintedTotal(money: Pick<PrintContext["money"], "subtotal" | "discount" | "tax" | "taxMode">): number {
  const tax = money.taxMode === "added" ? money.tax : money.taxMode === "exempt" ? -money.tax : 0;
  return roundMoney(money.subtotal - money.discount + tax);
}
