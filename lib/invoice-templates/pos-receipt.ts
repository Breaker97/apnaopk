/**
 * The POS receipt on a template (docs/INVOICE_TEMPLATE_BUILDER.md §4.11, §7
 * Phase 6 step 5). Client-safe: the till runs it online and offline.
 *
 * - `PosInvoiceTemplate` is what rides in `POSSettings.invoiceTemplate`: the
 *   resolved POS default's design and nothing else, `null` above
 *   `POS_TEMPLATE_MAX_BYTES` (the till then prints the legacy receipt).
 * - `posReceiptContext` turns the receipt the till already built
 *   (`ReceiptPrintPayload`: the sale, the sale-complete reprint, the sales
 *   dialog's reprint, a deposit's balance receipt) into the render context
 *   through `buildPosContext`, with the receipt's own figures, so the template
 *   prints the same Sub Total, Discount, Tax and TOTAL as the legacy receipt
 *   and they add up the same way (`posPrintedTotal === money.total`). A sale
 *   just rung up adds its cart lines (SKU, variant, line notes and
 *   discounts), its customer and its cashier.
 * - An offline sale (a provisional receipt number) prints no QR code that
 *   points at the order: its tracking page can't find it until it has synced.
 */
import type { ReceiptPrintPayload } from "@/lib/pos/receipt-html";
import type { PrintContext } from "./context-types";
import { buildPosContext, type PosContextLine } from "./pos-context";
import { designBytes } from "./schema";
import type { InvoiceTemplate, TemplateDesign, TemplateLocale } from "./types";

/** The largest POS template carried in the till's page (D-18). */
export const POS_TEMPLATE_MAX_BYTES = 64 * 1024;

export interface PosInvoiceTemplate {
  id: string;
  name: string;
  version: number;
  design: TemplateDesign;
}

/** The till's copy of a POS default: its design, or null when there is none or it is over the cap. */
export function posTemplatePayload(template: InvoiceTemplate | null | undefined): PosInvoiceTemplate | null {
  if (!template || template.category !== "pos") return null;
  const payload: PosInvoiceTemplate = {
    id: template.id,
    name: template.name,
    version: template.version,
    design: { locale: template.locale, canvas: template.canvas, format: template.format, elements: template.elements },
  };
  return designBytes(payload) <= POS_TEMPLATE_MAX_BYTES ? payload : null;
}

/** A provisional number an offline sale prints (`lib/pos/offline-receipt.ts`: `T0` or T + four characters, then a sequence). */
export function isLocalReceiptNumber(orderNumber: string): boolean {
  return /^T(?:0|[0-9A-Z]{4})-\d{4,}$/.test(String(orderNumber || "").trim());
}

/** The design without QR codes that open the order (tracking page or link); a fixed address or the website stays. */
export function withoutOrderQrCodes(design: TemplateDesign): TemplateDesign {
  const elements = design.elements.filter(
    (element) =>
      !(element.type === "qr" && ["orderTrackingPage", "trackingLink"].includes(String((element.config as { source?: unknown }).source))),
  );
  return elements.length === design.elements.length ? design : { ...design, elements };
}

export interface PosReceiptExtras {
  /** The cart as rung up: richer than the receipt's lines (SKU, variant, notes, line discounts). */
  lines?: ReadonlyArray<PosContextLine>;
  customer?: { name?: string; phone?: string; email?: string } | null;
  cashierName?: string;
  /** false: queued offline, not yet on the server. */
  synced?: boolean;
}

export interface PosReceiptContextOptions {
  settings: {
    currency: string;
    storeName?: string;
    storePhone?: string;
    storeEmail?: string;
    storeAddress?: string;
    storeDomain?: string;
    logoUrl?: string;
    /** The store's tax registration (Settings → Tax), printed as `store.taxId`. */
    taxId?: string | null;
  };
  locale: TemplateLocale;
  extras?: PosReceiptExtras;
}

/** The render context for a receipt the till built, with the receipt's own figures. */
export function posReceiptContext(receipt: ReceiptPrintPayload, options: PosReceiptContextOptions): PrintContext {
  const mode = receipt.taxMode ?? "added";
  const due = Math.max(0, Number(receipt.balanceDue) || 0);
  // The receipt lists tenders by name; a receipt without them was paid in one way.
  const payments = receipt.payments?.length
    ? receipt.payments
    : [{ label: receipt.paymentMethod, amount: Math.max(0, receipt.total - due) }];
  const lines: ReadonlyArray<PosContextLine> =
    options.extras?.lines ??
    receipt.items.map((item) => ({ productId: "", vendorId: "", sku: "", name: item.name, price: item.price, quantity: item.quantity }));

  const context = buildPosContext({
    orderNumber: receipt.orderNumber,
    createdAt: receipt.createdAt,
    lines,
    totals: {
      subtotal: receipt.subtotal,
      totalDiscount: receipt.discount,
      tax: receipt.tax,
      includedTax: receipt.tax,
      total: receipt.total,
      inclusive: mode === "included",
      exempt: mode === "exempt",
    },
    taxExemptReason: receipt.taxExemptReason,
    tenders: payments.map((payment) => ({ method: payment.label, amount: payment.amount })),
    change: receipt.balanceReturned,
    balanceDue: due,
    tenderLabel: (label) => label,
    settings: options.settings,
    counterName: receipt.locationName,
    cashierName: options.extras?.cashierName,
    customer: options.extras?.customer ?? null,
    locale: options.locale,
  });
  // The receipt knows the cash handed over; the tenders above are named, not coded.
  return {
    ...context,
    pos: context.pos && {
      ...context.pos,
      cashTendered: receipt.cashTendered && receipt.cashTendered > 0 ? receipt.cashTendered : null,
    },
  };
}
