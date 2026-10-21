/**
 * The built-in presets (§5.9): real, distinct starting layouts, with their
 * text in English or Bangla (D-14 — created in the admin's language and then
 * stored in the template like any other text). A preset is only a starting
 * point (D-02): nothing prints from one until a template made from it is set
 * as the default. Visual polish is Phase 2's; what is pinned here is that
 * every preset is a valid template that fits its page.
 *
 * Client-safe.
 */
import { canvasForSize, CATEGORY_DEFAULT_SIZE, type CanvasSizeKey } from "./canvas-sizes";
import type { FieldKey } from "./field-keys";
import {
  DEFAULT_FORMAT,
  defaultElement,
  type ElementBinding,
  type ElementConfigMap,
  type ElementFormat,
  type ElementStyle,
  type ElementType,
  type FlowConfig,
  type ShowOn,
  type TemplateCategory,
  type TemplateDesign,
  type TemplateElement,
  type TemplateLocale,
} from "./types";

export const PRESET_KEYS = [
  "standard-invoice",
  "minimal",
  "bold-cod",
  "premium",
  "compact-a5",
  "standard-receipt",
  "compact-thermal",
  "thermal-58",
  "courier-label",
  "cod-sticker",
] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

export function isPresetKey(value: unknown): value is PresetKey {
  return typeof value === "string" && (PRESET_KEYS as readonly string[]).includes(value);
}

/**
 * The standard print as a preset (owner, 2026-10-13): the layout of what a
 * category prints with no default (D-02) — the order invoice PDF
 * (lib/orders/invoice-pdf.tsx) and the till's receipt (lib/pos/receipt-html.ts)
 * — so the manager can show it, and a template can start from it. The
 * standard print itself is unchanged; the sticker's has no preset.
 */
export const STANDARD_PRESETS: Partial<Record<TemplateCategory, PresetKey>> = {
  online: "standard-invoice",
  pos: "standard-receipt",
};

export function isStandardPreset(key: string): boolean {
  return Object.values(STANDARD_PRESETS).includes(key as PresetKey);
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const WORDS = {
  en: {
    invoice: "INVOICE",
    receipt: "RECEIPT",
    billTo: "Bill to",
    shipTo: "Ship to",
    from: "From",
    orderNo: "Order no.",
    date: "Date",
    payment: "Payment",
    method: "Payment method",
    counter: "Counter",
    cashier: "Cashier",
    delivery: "Delivery",
    item: "Item",
    sku: "SKU",
    qty: "Qty",
    price: "Price",
    total: "Total",
    subtotal: "Subtotal",
    deliveryCharge: "Delivery charge",
    discount: "Discount",
    tax: "Tax",
    paid: "Paid",
    due: "Due",
    codLabel: "Cash to collect",
    paidStamp: "PAID",
    note: "Note",
    thanks: "Thank you for your order!",
    thanksShort: "Thank you!",
    contents: "Contents",
    tracking: "Tracking",
    tenders: "Paid by",
    cashTendered: "Cash tendered",
    change: "Change",
    // Element names, shown in Layers and Review.
    nHeader: "Business header",
    nTitle: "Title",
    nSummary: "Order summary",
    nCustomer: "Customer address",
    nDelivery: "Delivery method",
    nProducts: "Products",
    nTotals: "Price summary",
    nCod: "COD badge",
    nNotes: "Notes",
    nThanks: "Thank-you line",
    nDivider: "Divider",
    nBarcode: "Barcode",
    nQr: "QR code",
    nBox: "Box",
    nTenders: "Tenders",
    nSender: "Sender",
    // The standard invoice's words, as the PDF prints them.
    sInvoice: "Invoice",
    sInvoiceNumber: "Invoice number",
    sDateOfIssue: "Date of issue",
    sStatus: "Status",
    sDetails: "Invoice details",
    sDescription: "Description",
    sUnitPrice: "Unit price",
    sShipping: "Shipping",
    sTaxes: "Taxes",
    sDuties: "Import duties",
    sNotesTitle: "NOTES",
    sNotes: "We appreciate your business. Should you need us to add VAT or extra notes let us know!",
    sQuestion: "Have a question?",
    // The standard receipt's words, as the till prints them.
    rOrderNo: "Order #",
    rPhone: "Phone",
    rQty: "QTY",
    rItem: "ITEM",
    rPrice: "PRICE",
    rAmount: "AMOUNT",
    rSubtotal: "Sub Total",
    rTotal: "TOTAL",
    rBalanceDue: "BALANCE DUE",
    rCashTendered: "Cash Tendered",
    rBalanceReturned: "Balance Returned",
    rThanks: "Thank you for your visit!",
    rComeAgain: "Please come again",
    rScan: "Scan to view digital receipt",
    nStoreName: "Store name",
    nLogo: "Logo",
    nStoreContact: "Store contact",
    nBillTo: "Bill-to heading",
    nCustomerName: "Customer name",
    nDetails: "Section heading",
    nQuestion: "Contact line",
    nCounter: "Counter",
    nTotal: "Total",
    nComeAgain: "Come-again line",
    nScan: "Scan hint",
  },
  bn: {
    invoice: "চালান",
    receipt: "রসিদ",
    billTo: "প্রাপক",
    shipTo: "পাঠানোর ঠিকানা",
    from: "প্রেরক",
    orderNo: "অর্ডার নং",
    date: "তারিখ",
    payment: "পেমেন্ট",
    method: "পেমেন্টের মাধ্যম",
    counter: "কাউন্টার",
    cashier: "ক্যাশিয়ার",
    delivery: "ডেলিভারি",
    item: "পণ্য",
    sku: "এসকেইউ",
    qty: "পরিমাণ",
    price: "দাম",
    total: "মোট",
    subtotal: "সাবটোটাল",
    deliveryCharge: "ডেলিভারি চার্জ",
    discount: "ছাড়",
    tax: "কর",
    paid: "পরিশোধিত",
    due: "বাকি",
    codLabel: "আদায়যোগ্য টাকা",
    paidStamp: "পরিশোধিত",
    note: "নোট",
    thanks: "আপনার অর্ডারের জন্য ধন্যবাদ!",
    thanksShort: "ধন্যবাদ!",
    contents: "পণ্যসমূহ",
    tracking: "ট্র্যাকিং",
    tenders: "পরিশোধের মাধ্যম",
    cashTendered: "প্রদত্ত নগদ",
    change: "ফেরত",
    nHeader: "ব্যবসার শিরোনাম",
    nTitle: "শিরোনাম",
    nSummary: "অর্ডারের সারাংশ",
    nCustomer: "গ্রাহকের ঠিকানা",
    nDelivery: "ডেলিভারি পদ্ধতি",
    nProducts: "পণ্য তালিকা",
    nTotals: "মূল্যের সারাংশ",
    nCod: "ক্যাশ অন ডেলিভারি",
    nNotes: "নোট",
    nThanks: "ধন্যবাদ বার্তা",
    nDivider: "বিভাজক",
    nBarcode: "বারকোড",
    nQr: "কিউআর কোড",
    nBox: "বাক্স",
    nTenders: "পরিশোধ",
    nSender: "প্রেরক",
    sInvoice: "ইনভয়েস",
    sInvoiceNumber: "ইনভয়েস নম্বর",
    sDateOfIssue: "ইস্যুর তারিখ",
    sStatus: "অবস্থা",
    sDetails: "ইনভয়েসের বিবরণ",
    sDescription: "বিবরণ",
    sUnitPrice: "একক দাম",
    sShipping: "শিপিং",
    sTaxes: "কর",
    sDuties: "আমদানি শুল্ক",
    sNotesTitle: "নোট",
    sNotes: "আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ। ভ্যাট বা অতিরিক্ত কোনো নোট যোগ করতে হলে আমাদের জানান!",
    sQuestion: "কোনো প্রশ্ন আছে?",
    rOrderNo: "অর্ডার নং",
    rPhone: "ফোন",
    rQty: "পরিমাণ",
    rItem: "পণ্য",
    rPrice: "দাম",
    rAmount: "মূল্য",
    rSubtotal: "সাবটোটাল",
    rTotal: "মোট",
    rBalanceDue: "বাকি",
    rCashTendered: "প্রদত্ত নগদ",
    rBalanceReturned: "ফেরত",
    rThanks: "আসার জন্য ধন্যবাদ!",
    rComeAgain: "আবার আসবেন",
    rScan: "ডিজিটাল রসিদ দেখতে স্ক্যান করুন",
    nStoreName: "দোকানের নাম",
    nLogo: "লোগো",
    nStoreContact: "দোকানের যোগাযোগ",
    nBillTo: "প্রাপকের শিরোনাম",
    nCustomerName: "গ্রাহকের নাম",
    nDetails: "অংশের শিরোনাম",
    nQuestion: "যোগাযোগের লাইন",
    nCounter: "কাউন্টার",
    nTotal: "মোট",
    nComeAgain: "আবার আসার বার্তা",
    nScan: "স্ক্যানের নির্দেশনা",
  },
} as const;

type Words = { readonly [K in keyof (typeof WORDS)["en"]]: string };

const PRESET_NAMES: Record<PresetKey, Record<TemplateLocale, string>> = {
  "standard-invoice": { en: "Standard invoice", bn: "স্ট্যান্ডার্ড ইনভয়েস" },
  "standard-receipt": { en: "Standard receipt", bn: "স্ট্যান্ডার্ড রসিদ" },
  minimal: { en: "Minimal", bn: "মিনিমাল" },
  "bold-cod": { en: "Bold COD", bn: "বোল্ড সিওডি" },
  premium: { en: "Premium", bn: "প্রিমিয়াম" },
  "compact-a5": { en: "Compact A5", bn: "কমপ্যাক্ট এ৫" },
  "compact-thermal": { en: "Compact Thermal", bn: "কমপ্যাক্ট থার্মাল" },
  "thermal-58": { en: "Thermal 58", bn: "থার্মাল ৫৮" },
  "courier-label": { en: "Courier Label", bn: "কুরিয়ার লেবেল" },
  "cod-sticker": { en: "COD Sticker", bn: "সিওডি স্টিকার" },
};

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

type Placement = [x: number, y: number, width: number, height: number];

type Extra<T extends ElementType> = {
  showOn?: ShowOn;
  style?: Partial<ElementStyle>;
  config?: Partial<ElementConfigMap[T]>;
  binding?: ElementBinding;
  format?: ElementFormat;
  flow?: Partial<FlowConfig>;
};

/** Builds a preset's elements in drawing order, each id and z-index in turn. */
function builder() {
  const elements: TemplateElement[] = [];
  return {
    elements,
    add<T extends ElementType>(type: T, name: string, [x, y, width, height]: Placement, extra: Extra<T> = {}) {
      const base = defaultElement(type, {
        id: `${type}-${elements.length + 1}`,
        name,
        xMm: x,
        yMm: y,
        zIndex: elements.length + 1,
      }) as TemplateElement;
      const element = {
        ...base,
        widthMm: width,
        heightMm: height,
        ...(extra.showOn ? { showOn: extra.showOn } : {}),
        ...(extra.binding ? { binding: extra.binding } : {}),
        ...(extra.format ? { format: extra.format } : {}),
        style: { ...base.style, ...extra.style },
        config: { ...base.config, ...extra.config },
        ...(base.flow ? { flow: { ...base.flow, ...extra.flow } } : {}),
      } as TemplateElement;
      elements.push(element);
      return element;
    },
  };
}

const fixed = (text: string): ElementBinding => ({ mode: "fixed", text });
const field = (key: FieldKey, extra: Omit<ElementBinding, "mode" | "field"> = {}): ElementBinding => ({
  mode: "field",
  field: key,
  ...extra,
});

function orderSummaryFields(w: Words, pos = false) {
  return [
    { key: "order.number" as const, visible: true, label: w.orderNo },
    { key: "order.date" as const, visible: true, label: w.date },
    ...(pos
      ? [
          { key: "pos.counter" as const, visible: true, label: w.counter },
          { key: "pos.cashier" as const, visible: true, label: w.cashier },
        ]
      : [{ key: "order.paymentStatus" as const, visible: true, label: w.payment }]),
  ];
}

function onlineColumns(w: Words, withSku = true) {
  return [
    { key: "item.name" as const, label: w.item, widthPct: withSku ? 40 : 52, align: "left" as const },
    ...(withSku ? [{ key: "item.sku" as const, label: w.sku, widthPct: 16, align: "left" as const }] : []),
    { key: "item.qty" as const, label: w.qty, widthPct: 10, align: "center" as const },
    { key: "item.unitPrice" as const, label: w.price, widthPct: 16, align: "right" as const },
    { key: "item.lineTotal" as const, label: w.total, widthPct: 18, align: "right" as const },
  ];
}

function priceRows(w: Words, keys: Array<"subtotal" | "delivery" | "discount" | "tax" | "total" | "paid" | "due">) {
  const labels = {
    subtotal: w.subtotal,
    delivery: w.deliveryCharge,
    discount: w.discount,
    tax: w.tax,
    total: w.total,
    paid: w.paid,
    due: w.due,
  };
  return keys.map((key) => ({
    key,
    label: labels[key],
    hideWhenZero: key === "discount" || key === "tax" || key === "paid",
    asDeduction: key === "discount" || key === "paid",
    bold: key === "total" || key === "due",
  }));
}

/** The canvas a preset sits on, in the preset's language. */
function canvasFor(size: CanvasSizeKey, locale: TemplateLocale, overrides: Parameters<typeof canvasForSize>[1] = {}) {
  const canvas = canvasForSize(size, overrides);
  // Bangla text reads best in a Bangla face; a roll keeps the receipt font,
  // whose stack still ends in Noto Sans Bengali.
  if (locale === "bn" && canvas.heightMode === "fixed") canvas.defaultFont = "bangla-friendly";
  return canvas;
}

type PresetBuild = (w: Words, locale: TemplateLocale) => Omit<TemplateDesign, "locale" | "format"> & {
  format?: TemplateDesign["format"];
};

const BUILDS: Record<PresetKey, PresetBuild> = {
  "standard-invoice": standardInvoice,
  "standard-receipt": standardReceipt,

  // Clean, thin rules, white space.
  minimal: (w, locale) => {
    const b = builder();
    b.add("businessHeader", w.nHeader, [10, 10, 120, 28]);
    b.add("text", w.nTitle, [140, 10, 60, 10], {
      binding: fixed(w.invoice),
      style: { fontSizePx: 22, fontWeight: 600, textAlign: "right", color: "#222222" },
    });
    b.add("orderSummary", w.nSummary, [140, 22, 60, 16], { config: { fields: orderSummaryFields(w) } });
    b.add("line", w.nDivider, [10, 42, 190, 0.5], { style: { borderColor: "#cccccc" } });
    // Who and how print once; continuation pages give their space to rows.
    b.add("customerAddress", w.nCustomer, [10, 46, 100, 30], { showOn: "first", config: { title: w.billTo } });
    b.add("deliveryMethod", w.nDelivery, [120, 46, 80, 20], { showOn: "first" });
    b.add("productTable", w.nProducts, [10, 80, 190, 150], {
      config: { columns: onlineColumns(w), lines: "rows", headerFill: "", headerColor: "#555555" },
    });
    b.add("notes", w.nNotes, [10, 236, 100, 26], { showOn: "last", config: { title: w.note } });
    b.add("priceSummary", w.nTotals, [120, 236, 80, 36], {
      config: { rows: priceRows(w, ["subtotal", "delivery", "discount", "tax", "total", "paid", "due"]) },
    });
    b.add("text", w.nThanks, [10, 280, 190, 7], {
      showOn: "last",
      binding: fixed(w.thanks),
      style: { textAlign: "center", fontSizePx: 11, color: "#666666" },
    });
    return { canvas: canvasFor("a4-portrait", locale), elements: b.elements };
  },

  // A large cash-to-collect badge and heavy headings.
  "bold-cod": (w, locale) => {
    const b = builder();
    b.add("businessHeader", w.nHeader, [10, 10, 105, 30], { style: { fontSizePx: 13, fontWeight: 700 } });
    b.add("codBadge", w.nCod, [120, 10, 80, 26], {
      config: { label: w.codLabel, paidLabel: w.paidStamp },
      style: { fontSizePx: 22, fontWeight: 700, color: "#ffffff", background: "#111111", textAlign: "center", radiusPx: 6, paddingMm: 2 },
      showOn: "every",
    });
    b.add("text", w.nTitle, [10, 44, 90, 12], {
      binding: fixed(w.invoice),
      style: { fontSizePx: 26, fontWeight: 700 },
    });
    b.add("orderSummary", w.nSummary, [120, 40, 80, 18], {
      config: { fields: orderSummaryFields(w) },
      style: { fontWeight: 600 },
    });
    b.add("customerAddress", w.nCustomer, [10, 60, 110, 40], {
      showOn: "first",
      config: { title: w.shipTo },
      style: { fontSizePx: 14, fontWeight: 700, lineHeight: 1.25, borderStyle: "solid", borderWidthPx: 2, paddingMm: 3 },
    });
    b.add("barcode", w.nBarcode, [130, 64, 70, 22], { showOn: "first", config: { source: "orderNumber" } });
    b.add("productTable", w.nProducts, [10, 104, 190, 131], {
      config: { columns: onlineColumns(w, false), lines: "grid", headerFill: "#111111", headerColor: "#ffffff" },
      style: { fontSizePx: 12 },
    });
    b.add("priceSummary", w.nTotals, [110, 240, 90, 42], {
      config: { rows: priceRows(w, ["subtotal", "delivery", "discount", "tax", "total", "paid", "due"]) },
      style: { fontSizePx: 14, fontWeight: 600 },
    });
    b.add("notes", w.nNotes, [10, 240, 95, 30], { showOn: "last", config: { title: w.note } });
    return { canvas: canvasFor("a4-portrait", locale), elements: b.elements };
  },

  // Logo-led header, an accent colour, boxed sections.
  premium: (w, locale) => {
    const accent = "#1f4e79";
    const b = builder();
    b.add("box", w.nBox, [10, 10, 190, 34], { style: { background: accent, radiusPx: 6 } });
    b.add("businessHeader", w.nHeader, [14, 12, 112, 30], {
      config: { logoPlacement: "top" },
      style: { color: "#ffffff" },
    });
    b.add("text", w.nTitle, [136, 14, 60, 12], {
      binding: fixed(w.invoice),
      style: { fontSizePx: 24, fontWeight: 600, color: "#ffffff", textAlign: "right", fontFamily: locale === "bn" ? "bangla-friendly" : "elegant-serif" },
    });
    b.add("orderSummary", w.nSummary, [136, 28, 60, 14], {
      config: { fields: orderSummaryFields(w) },
      style: { color: "#ffffff", fontSizePx: 10 },
    });
    b.add("customerAddress", w.nCustomer, [10, 50, 92, 32], {
      showOn: "first",
      config: { title: w.billTo },
      style: { borderStyle: "solid", borderWidthPx: 1, borderColor: accent, radiusPx: 4, paddingMm: 3 },
    });
    b.add("deliveryMethod", w.nDelivery, [108, 50, 92, 32], {
      showOn: "first",
      style: { borderStyle: "solid", borderWidthPx: 1, borderColor: accent, radiusPx: 4, paddingMm: 3 },
    });
    b.add("productTable", w.nProducts, [10, 90, 190, 140], {
      config: { columns: onlineColumns(w), lines: "rows", headerFill: accent, headerColor: "#ffffff", stripeColor: "#f3f6fa" },
    });
    b.add("priceSummary", w.nTotals, [120, 236, 80, 40], {
      config: { rows: priceRows(w, ["subtotal", "delivery", "discount", "tax", "total", "paid", "due"]) },
      style: { borderStyle: "solid", borderWidthPx: 1, borderColor: accent, radiusPx: 4, paddingMm: 3 },
    });
    b.add("qr", w.nQr, [10, 240, 24, 24], { config: { source: "trackingLink" } });
    b.add("text", w.nThanks, [38, 248, 76, 8], {
      showOn: "last",
      binding: fixed(w.thanks),
      style: { color: accent, fontStyle: "italic" },
    });
    return { canvas: canvasFor("a4-portrait", locale), elements: b.elements };
  },

  // Dense, for small printers: A5 landscape.
  "compact-a5": (w, locale) => {
    const small = { fontSizePx: 9 };
    const b = builder();
    b.add("businessHeader", w.nHeader, [8, 8, 90, 20], { config: { logoPlacement: "left" }, style: small });
    b.add("text", w.nTitle, [150, 8, 52, 8], {
      binding: fixed(w.invoice),
      style: { fontSizePx: 16, fontWeight: 700, textAlign: "right" },
    });
    b.add("orderSummary", w.nSummary, [150, 17, 52, 12], { config: { fields: orderSummaryFields(w) }, style: small });
    b.add("customerAddress", w.nCustomer, [100, 8, 48, 22], { config: { title: w.billTo }, style: small });
    b.add("productTable", w.nProducts, [8, 32, 194, 80], {
      config: { columns: onlineColumns(w), lines: "grid", headerFill: "#eeeeee" },
      style: { ...small, paddingMm: 0.5 },
    });
    b.add("priceSummary", w.nTotals, [140, 115, 62, 25], {
      config: { rows: priceRows(w, ["subtotal", "delivery", "discount", "tax", "total", "due"]) },
      style: small,
    });
    b.add("notes", w.nNotes, [8, 115, 128, 18], { showOn: "last", config: { title: w.note }, style: small });
    return { canvas: canvasFor("a5-landscape", locale), elements: b.elements };
  },


  // The till's receipt: dense rows, totals, tenders, cash and change, a QR code; grows with the sale.
  "compact-thermal": (w, locale) => receipt(w, locale, "thermal-80"),
  "thermal-58": (w, locale) => receipt(w, locale, "thermal-58"),

  // Big recipient block, barcode, QR, courier, tracking, product rows.
  "courier-label": (w, locale) => {
    const b = builder();
    b.add("customerAddress", w.nCustomer, [3, 3, 94, 40], {
      config: { title: w.shipTo, fields: [
        { key: "name", visible: true },
        { key: "phone", visible: true },
        { key: "address", visible: true },
        { key: "email", visible: false },
      ] },
      style: { fontSizePx: 15, fontWeight: 600, lineHeight: 1.25 },
    });
    b.add("codBadge", w.nCod, [3, 45, 94, 14], {
      showOn: "every",
      config: { label: w.codLabel, paidLabel: w.paidStamp },
      style: { fontSizePx: 18, fontWeight: 700, color: "#ffffff", background: "#000000", textAlign: "center" },
    });
    b.add("barcode", w.nBarcode, [3, 62, 94, 24], { config: { source: "trackingNumber" } });
    b.add("qr", w.nQr, [3, 89, 24, 24], { config: { source: "trackingLink" } });
    b.add("deliveryMethod", w.nDelivery, [30, 89, 67, 24], { style: { fontSizePx: 11 } });
    b.add("productRows", w.nProducts, [3, 116, 94, 20], {
      config: { fields: ["item.name", "item.variant", "item.qty"] },
      flow: { enabled: false },
      style: { fontSizePx: 9 },
    });
    b.add("businessHeader", w.nSender, [3, 138, 94, 9], {
      config: { logoPlacement: "left", fields: [
        { key: "name", visible: true, label: w.from },
        { key: "phone", visible: true },
        { key: "logo", visible: true },
        { key: "email", visible: false },
        { key: "address", visible: false },
        { key: "website", visible: false },
        { key: "facebook", visible: false },
      ] },
      style: { fontSizePx: 9 },
    });
    return { canvas: canvasFor("sticker-100x150", locale), elements: b.elements };
  },

  // Recipient, cash to collect, barcode.
  "cod-sticker": (w, locale) => {
    const b = builder();
    b.add("customerAddress", w.nCustomer, [3, 3, 70, 36], {
      config: { title: w.shipTo },
      style: { fontSizePx: 13, fontWeight: 600 },
    });
    b.add("codBadge", w.nCod, [3, 41, 70, 16], {
      showOn: "every",
      config: { label: w.codLabel, paidLabel: w.paidStamp },
      style: { fontSizePx: 18, fontWeight: 700, color: "#ffffff", background: "#000000", textAlign: "center" },
    });
    b.add("barcode", w.nBarcode, [3, 60, 70, 24], { config: { source: "trackingNumber" } });
    b.add("text", w.nSummary, [3, 87, 70, 10], {
      binding: field("order.number", { before: `${w.orderNo}: ` }),
      style: { fontSizePx: 11, textAlign: "center" },
    });
    return { canvas: canvasFor("sticker-76x102", locale), elements: b.elements };
  },
};

/**
 * The POS receipt, on an 80 or 58 mm roll; the 58 mm one drops the counter
 * and the cashier. The product table's box holds its heading and
 * one row: a roll grows with the sale (push-down), never shrinks, so a short
 * sale prints no gap above the totals.
 */
function receipt(w: Words, locale: TemplateLocale, size: "thermal-80" | "thermal-58") {
  const narrow = size === "thermal-58";
  const left = narrow ? 5 : 4;
  const width = narrow ? 48 : 72;
  const small = { fontSizePx: narrow ? 9 : 10, lineHeight: 1.2 };
  const b = builder();
  const headerHeight = 20;
  b.add("businessHeader", w.nHeader, [left, 2, width, headerHeight], {
    config: { logoPlacement: "top" },
    style: { ...small, textAlign: "center" },
  });
  const titleTop = 3 + headerHeight;
  b.add("text", w.nTitle, [left, titleTop, width, 5], {
    binding: fixed(w.receipt),
    style: { ...small, fontWeight: 700, textAlign: "center" },
  });
  const summaryHeight = narrow ? 8 : 14;
  b.add("orderSummary", w.nSummary, [left, titleTop + 6, width, summaryHeight], {
    config: { fields: narrow ? orderSummaryFields(w, true).slice(0, 2) : orderSummaryFields(w, true) },
    style: small,
  });
  const tableTop = titleTop + 6 + summaryHeight + 2;
  const tableHeight = 10;
  b.add("line", w.nDivider, [left, tableTop - 1, width, 0.3], { style: { borderStyle: "dashed" } });
  b.add("productTable", w.nProducts, [left, tableTop, width, tableHeight], {
    config: {
      columns: [
        // "পরিমাণ" needs 22 % of a 48 mm roll to stay on one line.
        { key: "item.name", label: w.item, widthPct: narrow ? 44 : 52, align: "left" },
        { key: "item.qty", label: w.qty, widthPct: narrow ? 22 : 14, align: "center" },
        { key: "item.lineTotal", label: w.total, widthPct: narrow ? 34 : 34, align: "right" },
      ],
      lines: "none",
      headerFill: "",
      cells: "wrap",
    },
    style: small,
  });
  const totalsTop = tableTop + tableHeight + 2;
  b.add("line", w.nDivider, [left, totalsTop - 1, width, 0.3], { style: { borderStyle: "dashed" } });
  b.add("priceSummary", w.nTotals, [left, totalsTop, width, 26], {
    config: { rows: priceRows(w, ["subtotal", "discount", "tax", "total", "paid", "due"]) },
    style: small,
  });
  b.add("text", w.nTenders, [left, totalsTop + 27, width, 5], {
    binding: field("pos.tenders", { before: `${w.tenders}: ` }),
    style: small,
  });
  // The cash handed over and the change, as the legacy receipt prints them;
  // each prints nothing on a sale without cash (or without change). Side by
  // side on 80 mm; one under the other on 58 mm, to stay at the receipt size.
  const cashTop = totalsTop + 33;
  const cash = field("pos.cashTendered", { before: `${w.cashTendered}: ` });
  const change = field("pos.change", { before: `${w.change}: ` });
  if (narrow) {
    b.add("text", w.cashTendered, [left, cashTop, width, 4.5], { binding: cash, style: small });
    b.add("text", w.change, [left, cashTop + 5, width, 4.5], { binding: change, style: small });
  } else {
    const cashWidth = 40;
    b.add("text", w.cashTendered, [left, cashTop, cashWidth, 5], { binding: cash, style: small });
    b.add("text", w.change, [left + cashWidth + 1, cashTop, width - cashWidth - 1, 5], {
      binding: change,
      style: { ...small, textAlign: "right" },
    });
  }
  const qrTop = cashTop + (narrow ? 9.5 : 5) + 2;
  const qrSize = narrow ? 20 : 24;
  b.add("qr", w.nQr, [left + (width - qrSize) / 2, qrTop, qrSize, qrSize], {
    config: { source: "orderTrackingPage" },
  });
  b.add("text", w.nThanks, [left, qrTop + qrSize + 2, width, 5], {
    binding: fixed(w.thanksShort),
    style: { ...small, textAlign: "center" },
  });
  const bottom = qrTop + qrSize + 2 + 5 + 2;
  return { canvas: canvasFor(size, locale, { heightMm: bottom, minHeightMm: bottom }), elements: b.elements };
}

/**
 * The order invoice PDF (lib/orders/invoice-pdf.tsx) as a template: "Invoice"
 * and the store's logo (its name without one), the invoice facts, a rule, the store and Bill to side
 * by side, "Invoice details" over the lines, the totals at the right, the
 * notes and the store's email at the foot of every page. Its sizes and
 * colours are the PDF's (pt × 4/3 = px). What a template can't draw is left
 * out: the PDF's "Date due" and a pre-order's paid and balance rows.
 */
function standardInvoice(w: Words, locale: TemplateLocale) {
  const ink = "#212B36";
  const muted = "#637381";
  const body = { fontSizePx: 13, color: ink };
  const contact = { fontSizePx: 13, lineHeight: 1.5, color: muted };
  const b = builder();
  b.add("text", w.nTitle, [17, 15, 90, 11], {
    binding: fixed(w.sInvoice),
    style: { fontSizePx: 29, fontWeight: 700, lineHeight: 1.2, color: ink },
  });
  // The PDF's logo, at most 40 pt high, level with "Invoice"; its name in the PDF's style without one.
  b.add("image", w.nLogo, [113, 13.5, 80, 14], {
    config: { source: "storeLogo", fit: "contain", nameWhenNoLogo: true },
    style: { fontSizePx: 21, fontWeight: 700, lineHeight: 1.2, textAlign: "right", verticalAlign: "middle", color: ink },
  });
  b.add("orderSummary", w.nSummary, [17, 31, 72.5, 16], {
    config: {
      fields: [
        { key: "order.number", visible: true, label: w.sInvoiceNumber },
        { key: "order.date", visible: true, label: w.sDateOfIssue },
        { key: "order.paymentStatus", visible: true, label: w.sStatus },
      ],
      valueAlign: "left",
    },
    style: { ...body, gapMm: 1.9 },
  });
  b.add("line", w.nDivider, [17, 54, 176, 0.3], { style: { borderColor: "#DFE3E8" } });
  // The store and the customer print once; later pages give their room to rows.
  b.add("text", w.nStoreName, [17, 60, 85, 6], {
    showOn: "first",
    binding: field("store.name"),
    style: { fontSizePx: 15, fontWeight: 600, color: ink },
  });
  b.add("businessHeader", w.nStoreContact, [17, 66.5, 85, 26], {
    showOn: "first",
    config: {
      logoPlacement: "none",
      fields: [
        { key: "address", visible: true },
        { key: "phone", visible: true },
        { key: "email", visible: true },
        { key: "logo", visible: false },
        { key: "name", visible: false },
        { key: "website", visible: false },
        { key: "facebook", visible: false },
      ],
    },
    style: contact,
  });
  b.add("text", w.nBillTo, [110, 60, 83, 5], {
    showOn: "first",
    binding: fixed(w.billTo),
    style: { fontSizePx: 13, fontWeight: 600, color: muted },
  });
  b.add("text", w.nCustomerName, [110, 66, 83, 6], {
    showOn: "first",
    binding: field("customer.name"),
    style: { fontSizePx: 15, fontWeight: 600, color: ink },
  });
  b.add("customerAddress", w.nCustomer, [110, 72.5, 83, 32], {
    showOn: "first",
    config: {
      fields: [
        { key: "address", visible: true },
        { key: "phone", visible: true },
        { key: "email", visible: true },
        { key: "name", visible: false },
      ],
    },
    style: contact,
  });
  b.add("text", w.nDetails, [17, 108, 120, 7], {
    showOn: "first",
    binding: fixed(w.sDetails),
    style: { fontSizePx: 17, fontWeight: 600, color: ink },
  });
  // Seven lines fit above the totals, as on the PDF's first page; more continue on the next.
  b.add("productTable", w.nProducts, [17, 117, 176, 70], {
    config: {
      columns: [
        { key: "item.name", label: w.sDescription, widthPct: 56, align: "left" },
        { key: "item.qty", label: w.qty, widthPct: 12, align: "center" },
        { key: "item.unitPrice", label: w.sUnitPrice, widthPct: 16, align: "center" },
        { key: "item.lineTotal", label: w.total, widthPct: 16, align: "right" },
      ],
      lines: "rows",
      headerFill: "",
      headerColor: muted,
    },
    style: { ...body, lineHeight: 1.8, borderColor: "#DFE3E8" },
  });
  b.add("priceSummary", w.nTotals, [123, 191, 70, 40], {
    config: {
      rows: [
        { key: "subtotal", label: w.subtotal, hideWhenZero: false, asDeduction: false, bold: false },
        { key: "delivery", label: w.sShipping, hideWhenZero: true, asDeduction: false, bold: false },
        { key: "discount", label: w.discount, hideWhenZero: true, asDeduction: true, bold: false },
        { key: "tax", label: w.sTaxes, hideWhenZero: true, asDeduction: false, bold: false },
        { key: "duty", label: w.sDuties, hideWhenZero: true, asDeduction: false, bold: false },
        { key: "total", label: w.total, hideWhenZero: false, asDeduction: false, bold: true },
      ],
      labelAlign: "right",
    },
    style: { ...body, lineHeight: 1.5, gapMm: 3 },
  });
  // The PDF's footer, on every page.
  b.add("line", w.nDivider, [17, 264, 176, 0.3], { style: { borderColor: "#F4F6F8" } });
  b.add("notes", w.nNotes, [17, 268, 105, 18], {
    config: { source: "fixed", text: w.sNotes, title: w.sNotesTitle },
    style: { fontSizePx: 12, lineHeight: 1.5, color: muted },
  });
  b.add("text", w.nQuestion, [128, 268, 65, 12], {
    binding: field("store.email", { before: `${w.sQuestion}\n` }),
    style: { fontSizePx: 12, lineHeight: 1.5, textAlign: "right", color: muted },
  });
  return { canvas: canvasFor("a4-portrait", locale), elements: b.elements };
}

/**
 * The till's receipt (lib/pos/receipt-html.ts) as a template, on the 80 mm
 * roll's printable 72 mm: the store's name and contact lines, the counter,
 * the order facts, the lines, the totals with the cash handed over and the
 * change, TOTAL between rules, the order's barcode, the thank-you lines and
 * the QR code to the order's page. Its type sizes are the receipt's.
 */
function standardReceipt(w: Words, locale: TemplateLocale) {
  const left = 4;
  const width = 72;
  const small = { fontSizePx: 9, lineHeight: 1.25, color: "#000000" };
  const solid = { borderColor: "#000000" };
  const dashed = { ...solid, borderStyle: "dashed" as const };
  const b = builder();
  b.add("text", w.nStoreName, [left, 2, width, 5.5], {
    binding: field("store.name"),
    style: { fontSizePx: 13, fontWeight: 700, lineHeight: 1.1, textAlign: "center", color: "#000000" },
  });
  b.add("businessHeader", w.nStoreContact, [left, 8, width, 11], {
    config: {
      logoPlacement: "none",
      fields: [
        { key: "address", visible: true },
        { key: "phone", visible: true, label: w.rPhone },
        { key: "email", visible: true },
        { key: "logo", visible: false },
        { key: "name", visible: false },
        { key: "website", visible: false },
        { key: "facebook", visible: false },
      ],
    },
    style: { ...small, textAlign: "center" },
  });
  b.add("text", w.nCounter, [left, 19.5, width, 3.5], {
    binding: field("pos.counter", { before: `${w.counter}: ` }),
    style: { ...small, textAlign: "center" },
  });
  b.add("line", w.nDivider, [left, 24, width, 0.3], { style: dashed });
  b.add("orderSummary", w.nSummary, [left, 25.5, width, 10], {
    config: {
      fields: [
        { key: "order.number", visible: true, label: w.rOrderNo },
        { key: "order.date", visible: true, label: w.date },
        { key: "order.paymentMethod", visible: true, label: w.payment },
      ],
    },
    format: { date: "dd/MM/yyyy" },
    style: { ...small, gapMm: 0.6 },
  });
  b.add("line", w.nDivider, [left, 36.5, width, 0.3], { style: dashed });
  // The table's box holds its heading and one row: the roll grows with the sale.
  b.add("productTable", w.nProducts, [left, 38, width, 9], {
    config: {
      columns: [
        // "পরিমাণ" needs 16 % of the 72 mm to stay on one line.
        { key: "item.qty", label: w.rQty, widthPct: 16, align: "center" },
        { key: "item.name", label: w.rItem, widthPct: 40, align: "left" },
        { key: "item.unitPrice", label: w.rPrice, widthPct: 22, align: "right" },
        { key: "item.lineTotal", label: w.rAmount, widthPct: 22, align: "right" },
      ],
      lines: "none",
      headerFill: "",
      headerColor: "#000000",
      cells: "wrap",
    },
    style: { ...small, lineHeight: 1.2 },
  });
  // The receipt's rule under the headings: one 9 px line and its cell padding below the table's top.
  b.add("line", w.nDivider, [left, 42.4, width, 0.3], { style: solid });
  b.add("priceSummary", w.nTotals, [left, 48.5, width, 10], {
    config: {
      rows: [
        { key: "subtotal", label: w.rSubtotal, hideWhenZero: false, asDeduction: false, bold: false },
        { key: "discount", label: w.discount, hideWhenZero: true, asDeduction: true, bold: false },
        { key: "tax", label: w.tax, hideWhenZero: true, asDeduction: false, bold: false },
      ],
    },
    style: { ...small, gapMm: 0.6 },
  });
  // Each prints nothing on a sale without cash (or without change).
  b.add("text", w.cashTendered, [left, 59, width, 3.4], {
    binding: field("pos.cashTendered", { before: `${w.rCashTendered}: ` }),
    style: small,
  });
  b.add("text", w.change, [left, 62.6, width, 3.4], {
    binding: field("pos.change", { before: `${w.rBalanceReturned}: ` }),
    style: small,
  });
  b.add("line", w.nDivider, [left, 66.8, width, 0.3], { style: solid });
  b.add("priceSummary", w.nTotal, [left, 67.5, width, 9], {
    config: {
      rows: [
        { key: "total", label: w.rTotal, hideWhenZero: false, asDeduction: false, bold: true },
        { key: "due", label: w.rBalanceDue, hideWhenZero: true, asDeduction: false, bold: true },
      ],
    },
    style: { ...small, fontSizePx: 12, gapMm: 0.6 },
  });
  b.add("line", w.nDivider, [left, 77.5, width, 0.3], { style: dashed });
  b.add("barcode", w.nBarcode, [left + 7, 79, width - 14, 12], {
    config: { source: "orderNumber", textSizePx: 9 },
  });
  b.add("text", w.nThanks, [left, 92.5, width, 4], {
    binding: fixed(w.rThanks),
    style: { ...small, fontSizePx: 10, fontWeight: 700, textAlign: "center" },
  });
  b.add("text", w.nComeAgain, [left, 97, width, 3.5], {
    binding: fixed(w.rComeAgain),
    style: { ...small, fontSizePx: 8, textAlign: "center" },
  });
  const qrSize = 17;
  b.add("qr", w.nQr, [left + (width - qrSize) / 2, 101.5, qrSize, qrSize], {
    config: { source: "orderTrackingPage" },
  });
  b.add("text", w.nScan, [left, 119.5, width, 3.5], {
    binding: fixed(w.rScan),
    style: { ...small, fontSizePx: 8, textAlign: "center" },
  });
  const bottom = 125;
  return { canvas: canvasFor("thermal-80", locale, { heightMm: bottom, minHeightMm: bottom }), elements: b.elements };
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export type PresetDefinition = {
  key: PresetKey;
  category: TemplateCategory;
  size: CanvasSizeKey;
};

export const TEMPLATE_PRESETS: Record<PresetKey, PresetDefinition> = {
  "standard-invoice": { key: "standard-invoice", category: "online", size: "a4-portrait" },
  "standard-receipt": { key: "standard-receipt", category: "pos", size: "thermal-80" },
  minimal: { key: "minimal", category: "online", size: "a4-portrait" },
  "bold-cod": { key: "bold-cod", category: "online", size: "a4-portrait" },
  premium: { key: "premium", category: "online", size: "a4-portrait" },
  "compact-a5": { key: "compact-a5", category: "online", size: "a5-landscape" },
  "compact-thermal": { key: "compact-thermal", category: "pos", size: "thermal-80" },
  "thermal-58": { key: "thermal-58", category: "pos", size: "thermal-58" },
  "courier-label": { key: "courier-label", category: "sticker", size: "sticker-100x150" },
  "cod-sticker": { key: "cod-sticker", category: "sticker", size: "sticker-76x102" },
};

export function presetsFor(category: TemplateCategory): PresetDefinition[] {
  return PRESET_KEYS.map((key) => TEMPLATE_PRESETS[key]).filter((preset) => preset.category === category);
}

export function presetName(key: PresetKey, locale: TemplateLocale): string {
  return PRESET_NAMES[key][locale];
}

/** A preset's design, with its text in `locale`. */
export function buildPresetDesign(key: PresetKey, locale: TemplateLocale): TemplateDesign {
  const built = BUILDS[key](WORDS[locale], locale);
  return {
    locale,
    canvas: built.canvas,
    format: built.format ?? { ...DEFAULT_FORMAT },
    elements: built.elements,
  };
}

/** An empty canvas on the category's default size (§10: A4 / 80 mm / 100 × 150). */
export function blankDesign(category: TemplateCategory, locale: TemplateLocale): TemplateDesign {
  return {
    locale,
    canvas: canvasFor(CATEGORY_DEFAULT_SIZE[category], locale),
    format: { ...DEFAULT_FORMAT },
    elements: [],
  };
}
