/**
 * The field registry (docs/INVOICE_TEMPLATE_BUILDER.md §4.7.2): every key a
 * template element can be bound to, with its label, group, scope, the
 * categories it is valid in, a sample and a resolver over the render context.
 *
 * `resolve` returns `null` when the data is missing. **`null` prints the
 * fallback, or nothing, and skips the before/after text.** Nothing here ever
 * returns `undefined` or `NaN`: a missing figure is `null`, a present one is
 * a finite number.
 *
 * Values are typed by `valueType` so the renderer (Phase 2) can format them:
 * `money` is a number in `context.money.currency`, `date` an ISO string,
 * `multiline` a string with `\n` between lines, `url` and `image` strings.
 *
 * Client-safe: the editor, the preview and the till all read it.
 */
import { FIELD_KEYS, ITEM_FIELD_KEYS, type FieldKey, type ItemFieldKey } from "./field-keys";
import type { ContextItem, PrintContext } from "./context-types";
import { TEMPLATE_CATEGORIES, type TemplateCategory, type TemplateDesign, type TemplateLocale } from "./types";

export type FieldScope = "order" | "item" | "consignment" | "store" | "page" | "pos";
export type FieldGroup = "order" | "customer" | "money" | "delivery" | "items" | "store" | "pos" | "page";
export type FieldValueType = "text" | "multiline" | "money" | "number" | "date" | "url" | "image";
export type FieldValue = string | number | null;

type Labels = Record<TemplateLocale, string>;

export interface FieldDefinition {
  key: FieldKey;
  label: Labels;
  group: FieldGroup;
  scope: FieldScope;
  categories: readonly TemplateCategory[];
  valueType: FieldValueType;
  /** A value for the picker's live sample, in the admin's language. */
  sample: (locale: TemplateLocale) => FieldValue;
  resolve: (context: PrintContext) => FieldValue;
}

export interface ItemFieldDefinition {
  key: ItemFieldKey;
  label: Labels;
  valueType: FieldValueType;
  sample: (locale: TemplateLocale) => FieldValue;
  resolve: (item: ContextItem, context: PrintContext) => FieldValue;
}

const ALL = TEMPLATE_CATEGORIES;
const ONLINE_AND_STICKER = ["online", "sticker"] as const;
const POS_ONLY = ["pos"] as const;

const bn = (en: string, bangla: string): Labels => ({ en, bn: bangla });

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const amount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const lines = (values: ReadonlyArray<string | null | undefined>): string | null => {
  const kept = values.filter((line): line is string => Boolean(line && line.trim()));
  return kept.length > 0 ? kept.join("\n") : null;
};

// ---------------------------------------------------------------------------
// Labels for stored values
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_LABELS: Record<string, Labels> = {
  pending: bn("Pending", "বাকি"),
  paid: bn("Paid", "পরিশোধিত"),
  partially_paid: bn("Partially paid", "আংশিক পরিশোধিত"),
  refunded: bn("Refunded", "ফেরত দেওয়া হয়েছে"),
  partially_refunded: bn("Partially refunded", "আংশিক ফেরত"),
  expired: bn("Expired", "মেয়াদোত্তীর্ণ"),
  failed: bn("Failed", "ব্যর্থ"),
};

const PAYMENT_METHOD_LABELS: Record<string, Labels> = {
  cod: bn("Cash on delivery", "ক্যাশ অন ডেলিভারি"),
  cash: bn("Cash", "নগদ"),
  card: bn("Card", "কার্ড"),
  stripe: bn("Card", "কার্ড"),
  paypal: bn("PayPal", "PayPal"),
  bank: bn("Bank transfer", "ব্যাংক ট্রান্সফার"),
  bank_transfer: bn("Bank transfer", "ব্যাংক ট্রান্সফার"),
  bkash: bn("bKash", "বিকাশ"),
  nagad: bn("Nagad", "নগদ"),
  rocket: bn("Rocket", "রকেট"),
  sslcommerz: bn("SSLCommerz", "SSLCommerz"),
  razorpay: bn("Razorpay", "Razorpay"),
  paystack: bn("Paystack", "Paystack"),
  mobile_money: bn("Mobile money", "মোবাইল মানি"),
  store_credit: bn("Store credit", "স্টোর ক্রেডিট"),
  pay_later: bn("Pay later", "পরে পরিশোধ"),
  wallet: bn("Wallet", "ওয়ালেট"),
};

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function paymentStatusLabel(status: string | null, locale: TemplateLocale): string | null {
  const key = text(status)?.toLowerCase();
  if (!key) return null;
  return PAYMENT_STATUS_LABELS[key]?.[locale] ?? titleCase(key);
}

/** One method, or several joined by " + " (a split POS sale). */
export function paymentMethodLabel(method: string | null, locale: TemplateLocale): string | null {
  const raw = text(method);
  if (!raw) return null;
  return raw
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => PAYMENT_METHOD_LABELS[part]?.[locale] ?? titleCase(part))
    .join(" + ");
}

const PAGE_LABEL: Record<TemplateLocale, (n: number, c: number) => string> = {
  en: (n, c) => `Page ${n} of ${c}`,
  bn: (n, c) => `পৃষ্ঠা ${n} / ${c}`,
};

export function pageLabel(page: { number: number; count: number }, locale: TemplateLocale): string {
  return PAGE_LABEL[locale](page.number, page.count);
}

// ---------------------------------------------------------------------------
// Item lists
// ---------------------------------------------------------------------------

function itemDisplayName(item: ContextItem): string {
  return item.variant ? `${item.name} (${item.variant})` : item.name;
}

export function itemsNames(items: ReadonlyArray<ContextItem>): string | null {
  return items.length > 0 ? items.map(itemDisplayName).join(", ") : null;
}

export function itemsSkuQtyList(items: ReadonlyArray<ContextItem>): string | null {
  return lines(items.map((item) => `${item.sku ?? item.name} × ${item.qty}`));
}

/** Text that embeds an amount takes a formatter; the renderer passes the template's amount format (`bindings.ts`). */
export type AmountText = (value: number) => string;

export function itemsSummary(items: ReadonlyArray<ContextItem>, money: AmountText = String): string | null {
  return lines(items.map((item) => `${itemDisplayName(item)} × ${item.qty} — ${money(item.lineTotal)}`));
}

export function tendersText(tenders: ReadonlyArray<{ label: string; amount: number }>, money: AmountText = String): string | null {
  return lines(tenders.map((tender) => `${tender.label}: ${money(tender.amount)}`));
}

export function itemsTotalUnits(items: ReadonlyArray<ContextItem>): number {
  return items.reduce((sum, item) => sum + (Number.isFinite(item.qty) ? item.qty : 0), 0);
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const field = (definition: FieldDefinition): FieldDefinition => definition;

export const FIELDS: readonly FieldDefinition[] = [
  // Order
  field({
    key: "order.number",
    label: bn("Order / invoice number", "অর্ডার / চালান নম্বর"),
    group: "order",
    scope: "order",
    categories: ALL,
    valueType: "text",
    sample: () => "ORD-100042",
    resolve: (ctx) => text(ctx.order.number),
  }),
  field({
    key: "order.date",
    label: bn("Order date", "অর্ডারের তারিখ"),
    group: "order",
    scope: "order",
    categories: ALL,
    valueType: "date",
    sample: () => "2026-10-11T09:30:00.000Z",
    resolve: (ctx) => text(ctx.order.date),
  }),
  field({
    key: "order.paymentStatus",
    label: bn("Payment status", "পেমেন্টের অবস্থা"),
    group: "order",
    scope: "order",
    categories: ALL,
    valueType: "text",
    sample: (locale) => paymentStatusLabel("paid", locale),
    resolve: (ctx) => paymentStatusLabel(ctx.order.paymentStatus, ctx.locale),
  }),
  field({
    key: "order.paymentMethod",
    label: bn("Payment method", "পেমেন্টের মাধ্যম"),
    group: "order",
    scope: "order",
    categories: ALL,
    valueType: "text",
    sample: (locale) => paymentMethodLabel("cod", locale),
    resolve: (ctx) => paymentMethodLabel(ctx.order.paymentMethod, ctx.locale),
  }),
  field({
    key: "order.customerNote",
    label: bn("Customer note", "ক্রেতার নোট"),
    group: "order",
    scope: "order",
    categories: ALL,
    valueType: "multiline",
    sample: (locale) => (locale === "bn" ? "দয়া করে বিকেলে ডেলিভারি দিন" : "Please deliver in the afternoon"),
    resolve: (ctx) => text(ctx.order.customerNote),
  }),
  field({
    key: "order.internalNote",
    label: bn("Internal note (staff only)", "অভ্যন্তরীণ নোট (শুধু স্টাফ)"),
    group: "order",
    scope: "order",
    categories: ALL,
    valueType: "multiline",
    sample: (locale) => (locale === "bn" ? "ভঙ্গুর: সাবধানে প্যাক করুন" : "Fragile: pack with care"),
    resolve: (ctx) => text(ctx.order.internalNote),
  }),
  field({
    key: "order.takenBy",
    label: bn("Order taken by", "অর্ডার নিয়েছেন"),
    group: "order",
    scope: "order",
    categories: ALL,
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "রাহিম উদ্দিন" : "Rahim Uddin"),
    resolve: (ctx) => text(ctx.order.takenBy),
  }),

  // Customer
  field({
    key: "customer.name",
    label: bn("Customer name", "ক্রেতার নাম"),
    group: "customer",
    scope: "order",
    categories: ALL,
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "ফারহানা আক্তার" : "Farhana Akter"),
    resolve: (ctx) => text(ctx.customer.name),
  }),
  field({
    key: "customer.phone",
    label: bn("Customer phone", "ক্রেতার ফোন"),
    group: "customer",
    scope: "order",
    categories: ALL,
    valueType: "text",
    sample: () => "+8801712345678",
    resolve: (ctx) => text(ctx.customer.phone),
  }),
  field({
    key: "customer.email",
    label: bn("Customer email", "ক্রেতার ইমেইল"),
    group: "customer",
    scope: "order",
    categories: ALL,
    valueType: "text",
    sample: () => "farhana@example.com",
    resolve: (ctx) => text(ctx.customer.email),
  }),
  field({
    key: "customer.address",
    label: bn("Delivery address", "ডেলিভারি ঠিকানা"),
    group: "customer",
    scope: "order",
    categories: ALL,
    valueType: "multiline",
    sample: (locale) =>
      locale === "bn" ? "বাড়ি ১২, রোড ৫\nধানমন্ডি, ঢাকা ১২০৯\nবাংলাদেশ" : "House 12, Road 5\nDhanmondi, Dhaka 1209\nBangladesh",
    resolve: (ctx) => lines(ctx.customer.addressLines),
  }),

  // Money
  field({
    key: "money.subtotal",
    label: bn("Subtotal", "উপমোট"),
    group: "money",
    scope: "order",
    categories: ALL,
    valueType: "money",
    sample: () => 3150,
    resolve: (ctx) => amount(ctx.money.subtotal),
  }),
  field({
    key: "money.discount",
    label: bn("Discount", "ছাড়"),
    group: "money",
    scope: "order",
    categories: ALL,
    valueType: "money",
    sample: () => 150,
    resolve: (ctx) => amount(ctx.money.discount),
  }),
  field({
    key: "money.delivery",
    label: bn("Delivery charge", "ডেলিভারি চার্জ"),
    group: "money",
    scope: "order",
    categories: ALL,
    valueType: "money",
    sample: () => 80,
    resolve: (ctx) => amount(ctx.money.delivery),
  }),
  field({
    key: "money.tax",
    label: bn("Tax", "কর"),
    group: "money",
    scope: "order",
    categories: ALL,
    valueType: "money",
    sample: () => 0,
    resolve: (ctx) => amount(ctx.money.tax),
  }),
  field({
    key: "money.duty",
    label: bn("Import duty", "আমদানি শুল্ক"),
    group: "money",
    scope: "order",
    categories: ALL,
    valueType: "money",
    sample: () => 0,
    resolve: (ctx) => amount(ctx.money.duty),
  }),
  field({
    key: "money.total",
    label: bn("Total", "মোট"),
    group: "money",
    scope: "order",
    categories: ALL,
    valueType: "money",
    sample: () => 3080,
    resolve: (ctx) => amount(ctx.money.total),
  }),
  field({
    key: "money.paid",
    label: bn("Paid (advance)", "পরিশোধিত (অগ্রিম)"),
    group: "money",
    scope: "order",
    categories: ALL,
    valueType: "money",
    sample: () => 0,
    resolve: (ctx) => amount(ctx.money.paid),
  }),
  field({
    key: "money.due",
    label: bn("Due", "বাকি"),
    group: "money",
    scope: "order",
    categories: ALL,
    valueType: "money",
    sample: () => 3080,
    resolve: (ctx) => amount(ctx.money.due),
  }),
  field({
    key: "money.cod",
    label: bn("Cash to collect", "নগদ আদায়"),
    group: "money",
    scope: "order",
    categories: ALL,
    valueType: "money",
    sample: () => 3080,
    resolve: (ctx) => amount(ctx.money.cod),
  }),

  // Delivery
  field({
    key: "delivery.method",
    label: bn("Delivery method", "ডেলিভারির ধরন"),
    group: "delivery",
    scope: "consignment",
    categories: ONLINE_AND_STICKER,
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "স্ট্যান্ডার্ড ডেলিভারি" : "Standard delivery"),
    resolve: (ctx) => text(ctx.delivery.method),
  }),
  field({
    key: "delivery.courier",
    label: bn("Courier", "কুরিয়ার"),
    group: "delivery",
    scope: "consignment",
    categories: ONLINE_AND_STICKER,
    valueType: "text",
    sample: () => "Pathao",
    resolve: (ctx) => text(ctx.delivery.courier),
  }),
  field({
    key: "delivery.service",
    label: bn("Courier service", "কুরিয়ার সার্ভিস"),
    group: "delivery",
    scope: "consignment",
    categories: ONLINE_AND_STICKER,
    valueType: "text",
    sample: () => "Express",
    resolve: (ctx) => text(ctx.delivery.service),
  }),
  field({
    key: "delivery.trackingNumber",
    label: bn("Tracking number", "ট্র্যাকিং নম্বর"),
    group: "delivery",
    scope: "consignment",
    categories: ONLINE_AND_STICKER,
    valueType: "text",
    sample: () => "PT1234567890",
    resolve: (ctx) => text(ctx.delivery.trackingNumber),
  }),
  field({
    key: "delivery.trackingUrl",
    label: bn("Tracking link", "ট্র্যাকিং লিংক"),
    group: "delivery",
    scope: "consignment",
    categories: ONLINE_AND_STICKER,
    valueType: "url",
    sample: () => "https://example.com/track/PT1234567890",
    resolve: (ctx) => text(ctx.delivery.trackingUrl),
  }),
  field({
    key: "delivery.seller",
    label: bn("Seller", "বিক্রেতা"),
    group: "delivery",
    scope: "consignment",
    categories: ONLINE_AND_STICKER,
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "স্টোরিফাই" : "Storify"),
    resolve: (ctx) => text(ctx.delivery.seller),
  }),

  // Items (single-value summaries; per-line fields are columns)
  field({
    key: "items.names",
    label: bn("All product names", "সব পণ্যের নাম"),
    group: "items",
    scope: "order",
    categories: ALL,
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "জামদানি শাড়ি, সিরামিক মগ" : "Jamdani saree, Ceramic mug"),
    resolve: (ctx) => itemsNames(ctx.items),
  }),
  field({
    key: "items.skuQtyList",
    label: bn("Product list (SKU × qty)", "পণ্য তালিকা (SKU × পরিমাণ)"),
    group: "items",
    scope: "order",
    categories: ALL,
    valueType: "multiline",
    sample: () => "JAM-RED × 1\nMUG-WHT × 2",
    resolve: (ctx) => itemsSkuQtyList(ctx.items),
  }),
  field({
    key: "items.summary",
    label: bn("Product list with qty and price", "পরিমাণ ও দামসহ পণ্য তালিকা"),
    group: "items",
    scope: "order",
    categories: ALL,
    valueType: "multiline",
    sample: (locale) =>
      locale === "bn" ? "জামদানি শাড়ি × 1 — 4500\nসিরামিক মগ × 2 — 500" : "Jamdani saree × 1 — 4500\nCeramic mug × 2 — 500",
    resolve: (ctx) => itemsSummary(ctx.items),
  }),
  field({
    key: "items.totalUnits",
    label: bn("Total units", "মোট ইউনিট"),
    group: "items",
    scope: "order",
    categories: ALL,
    valueType: "number",
    sample: () => 3,
    resolve: (ctx) => itemsTotalUnits(ctx.items),
  }),

  // Store
  field({
    key: "store.name",
    label: bn("Store name", "দোকানের নাম"),
    group: "store",
    scope: "store",
    categories: ALL,
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "স্টোরিফাই" : "Storify"),
    resolve: (ctx) => text(ctx.store.name),
  }),
  field({
    key: "store.phone",
    label: bn("Store phone", "দোকানের ফোন"),
    group: "store",
    scope: "store",
    categories: ALL,
    valueType: "text",
    sample: () => "+8801700000000",
    resolve: (ctx) => text(ctx.store.phone),
  }),
  field({
    key: "store.email",
    label: bn("Store email", "দোকানের ইমেইল"),
    group: "store",
    scope: "store",
    categories: ALL,
    valueType: "text",
    sample: () => "shop@example.com",
    resolve: (ctx) => text(ctx.store.email),
  }),
  field({
    key: "store.address",
    label: bn("Store address", "দোকানের ঠিকানা"),
    group: "store",
    scope: "store",
    categories: ALL,
    valueType: "multiline",
    sample: (locale) => (locale === "bn" ? "বাড়ি ১২, রোড ৫, ধানমন্ডি, ঢাকা" : "House 12, Road 5, Dhanmondi, Dhaka"),
    resolve: (ctx) => text(ctx.store.address),
  }),
  field({
    key: "store.logo",
    label: bn("Store logo", "দোকানের লোগো"),
    group: "store",
    scope: "store",
    categories: ALL,
    valueType: "image",
    sample: () => "/logo.png",
    resolve: (ctx) => text(ctx.store.logo),
  }),
  field({
    key: "store.website",
    label: bn("Website", "ওয়েবসাইট"),
    group: "store",
    scope: "store",
    categories: ALL,
    valueType: "url",
    sample: () => "https://example.com",
    resolve: (ctx) => text(ctx.store.website),
  }),
  field({
    key: "store.facebook",
    label: bn("Facebook page", "ফেসবুক পেজ"),
    group: "store",
    scope: "store",
    categories: ALL,
    valueType: "url",
    sample: () => "https://facebook.com/example",
    resolve: (ctx) => text(ctx.store.facebook),
  }),
  field({
    key: "store.taxId",
    label: bn("Tax registration", "কর নিবন্ধন"),
    group: "store",
    scope: "store",
    categories: ALL,
    valueType: "text",
    sample: () => "Sales tax permit 123-456789",
    resolve: (ctx) => text(ctx.store.taxId),
  }),

  // POS
  field({
    key: "pos.counter",
    label: bn("Counter", "কাউন্টার"),
    group: "pos",
    scope: "pos",
    categories: POS_ONLY,
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "ধানমন্ডি কাউন্টার" : "Dhanmondi counter"),
    resolve: (ctx) => text(ctx.pos?.counter),
  }),
  field({
    key: "pos.cashier",
    label: bn("Cashier", "ক্যাশিয়ার"),
    group: "pos",
    scope: "pos",
    categories: POS_ONLY,
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "রাহিম উদ্দিন" : "Rahim Uddin"),
    resolve: (ctx) => text(ctx.pos?.cashier),
  }),
  field({
    key: "pos.tenders",
    label: bn("Payments (tender by tender)", "পেমেন্ট (প্রতিটি মাধ্যম)"),
    group: "pos",
    scope: "pos",
    categories: POS_ONLY,
    valueType: "multiline",
    sample: (locale) => (locale === "bn" ? "কার্ড: 1000\nনগদ: 610" : "Card: 1000\nCash: 610"),
    resolve: (ctx) => tendersText(ctx.pos?.tenders ?? []),
  }),
  field({
    key: "pos.cashTendered",
    label: bn("Cash tendered", "নগদ প্রদান"),
    group: "pos",
    scope: "pos",
    categories: POS_ONLY,
    valueType: "money",
    sample: () => 1200,
    resolve: (ctx) => amount(ctx.pos?.cashTendered),
  }),
  field({
    key: "pos.change",
    label: bn("Change", "ফেরত"),
    group: "pos",
    scope: "pos",
    categories: POS_ONLY,
    valueType: "money",
    sample: () => 45,
    resolve: (ctx) => amount(ctx.pos?.change),
  }),
  field({
    key: "pos.taxExemptReason",
    label: bn("Tax exemption reason", "কর অব্যাহতির কারণ"),
    group: "pos",
    scope: "pos",
    categories: POS_ONLY,
    valueType: "text",
    sample: () => "Diplomatic mission (EX-221)",
    resolve: (ctx) => text(ctx.pos?.taxExemptReason),
  }),

  // Page
  field({
    key: "page.number",
    label: bn("Page number", "পৃষ্ঠা নম্বর"),
    group: "page",
    scope: "page",
    categories: ALL,
    valueType: "number",
    sample: () => 1,
    resolve: (ctx) => ctx.page.number,
  }),
  field({
    key: "page.count",
    label: bn("Page count", "মোট পৃষ্ঠা"),
    group: "page",
    scope: "page",
    categories: ALL,
    valueType: "number",
    sample: () => 1,
    resolve: (ctx) => ctx.page.count,
  }),
  field({
    key: "page.label",
    label: bn("Page label", "পৃষ্ঠা লেবেল"),
    group: "page",
    scope: "page",
    categories: ALL,
    valueType: "text",
    sample: (locale) => pageLabel({ number: 1, count: 3 }, locale),
    resolve: (ctx) => pageLabel(ctx.page, ctx.locale),
  }),
];

const itemField = (definition: ItemFieldDefinition): ItemFieldDefinition => definition;

export const ITEM_FIELDS: readonly ItemFieldDefinition[] = [
  itemField({
    key: "item.name",
    label: bn("Name", "নাম"),
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "জামদানি শাড়ি" : "Jamdani saree"),
    resolve: (item) => text(item.name),
  }),
  itemField({
    key: "item.variant",
    label: bn("Variant", "ভ্যারিয়েন্ট"),
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "লাল / M" : "Red / M"),
    resolve: (item) => text(item.variant),
  }),
  itemField({
    key: "item.colour",
    label: bn("Colour", "রং"),
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "লাল" : "Red"),
    resolve: (item) => text(item.colour),
  }),
  itemField({
    key: "item.size",
    label: bn("Size", "সাইজ"),
    valueType: "text",
    sample: () => "M",
    resolve: (item) => text(item.size),
  }),
  itemField({
    key: "item.sku",
    label: bn("SKU", "SKU"),
    valueType: "text",
    sample: () => "JAM-RED-M",
    resolve: (item) => text(item.sku),
  }),
  itemField({
    key: "item.qty",
    label: bn("Quantity", "পরিমাণ"),
    valueType: "number",
    sample: () => 2,
    resolve: (item) => amount(item.qty),
  }),
  itemField({
    key: "item.unitPrice",
    label: bn("Unit price", "একক মূল্য"),
    valueType: "money",
    sample: () => 4500,
    resolve: (item) => amount(item.unitPrice),
  }),
  itemField({
    key: "item.compareAtPrice",
    label: bn("Original price", "আসল মূল্য"),
    valueType: "money",
    sample: () => 5200,
    resolve: (item) => amount(item.compareAtPrice),
  }),
  itemField({
    key: "item.lineDiscount",
    label: bn("Line discount", "লাইন ছাড়"),
    valueType: "money",
    sample: () => 100,
    resolve: (item) => amount(item.lineDiscount),
  }),
  itemField({
    key: "item.lineTotal",
    label: bn("Line total", "লাইন মোট"),
    valueType: "money",
    sample: () => 8900,
    resolve: (item) => amount(item.lineTotal),
  }),
  itemField({
    key: "item.image",
    label: bn("Image", "ছবি"),
    valueType: "image",
    sample: () => "/placeholder-product.png",
    resolve: (item) => text(item.image),
  }),
  itemField({
    key: "item.weight",
    label: bn("Weight", "ওজন"),
    valueType: "text",
    sample: () => "0.5 kg",
    resolve: (item) => text(item.weight),
  }),
  itemField({
    key: "item.note",
    label: bn("Line note", "লাইন নোট"),
    valueType: "text",
    sample: (locale) => (locale === "bn" ? "উপহার মোড়ক" : "Gift wrap"),
    resolve: (item) => text(item.note),
  }),
  itemField({
    key: "item.taxRate",
    label: bn("Tax rate (%)", "করের হার (%)"),
    valueType: "number",
    sample: () => 8.25,
    resolve: (item) => amount(item.taxRate),
  }),
  itemField({
    key: "item.tax",
    label: bn("Tax", "কর"),
    valueType: "money",
    sample: () => 742.5,
    resolve: (item) => amount(item.tax),
  }),
  itemField({
    key: "item.totalWithTax",
    label: bn("Total with tax", "করসহ মোট"),
    valueType: "money",
    sample: () => 9642.5,
    resolve: (item) => amount(item.totalWithTax),
  }),
];

const FIELD_BY_KEY: ReadonlyMap<FieldKey, FieldDefinition> = new Map(FIELDS.map((entry) => [entry.key, entry]));
const ITEM_FIELD_BY_KEY: ReadonlyMap<ItemFieldKey, ItemFieldDefinition> = new Map(
  ITEM_FIELDS.map((entry) => [entry.key, entry]),
);

if (FIELD_BY_KEY.size !== FIELD_KEYS.length || ITEM_FIELD_BY_KEY.size !== ITEM_FIELD_KEYS.length) {
  throw new Error("invoice-templates: the field registry and field-keys.ts disagree");
}

export function getField(key: FieldKey): FieldDefinition {
  return FIELD_BY_KEY.get(key)!;
}

export function getItemField(key: ItemFieldKey): ItemFieldDefinition {
  return ITEM_FIELD_BY_KEY.get(key)!;
}

/**
 * Whether a design prints the staff-only internal note (§4.14): a text
 * element bound to `order.internalNote`, or a Notes block reading it. The
 * admin print-context route puts the note into the context only then; the
 * vendor route never does.
 */
export function designUsesInternalNote(design: Pick<TemplateDesign, "elements"> | null | undefined): boolean {
  return (design?.elements ?? []).some(
    (element) =>
      (element.binding?.mode === "field" && element.binding.field === "order.internalNote") ||
      (element.type === "notes" && element.config.source === "internalNote"),
  );
}

/** Whether a field is valid for a category (the picker hides the rest). */
export function isFieldAvailable(key: FieldKey, category: TemplateCategory): boolean {
  return getField(key).categories.includes(category);
}

/** The fields the picker offers for a category, in registry order. */
export function fieldsForCategory(category: TemplateCategory): FieldDefinition[] {
  return FIELDS.filter((entry) => entry.categories.includes(category));
}

/**
 * The value a field prints for a context, or `null`. A key that is not valid
 * for the context's category still resolves (the Review tab warns instead).
 */
export function resolveField(key: FieldKey, context: PrintContext): FieldValue {
  const value = getField(key).resolve(context);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return value ?? null;
}

export function resolveItemField(key: ItemFieldKey, item: ContextItem, context: PrintContext): FieldValue {
  const value = getItemField(key).resolve(item, context);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return value ?? null;
}

/** Every field with its value, for the Review tab and tests. */
export function resolveAllFields(context: PrintContext): Record<FieldKey, FieldValue> {
  const out = {} as Record<FieldKey, FieldValue>;
  for (const key of FIELD_KEYS) out[key] = resolveField(key, context);
  return out;
}

export function resolveAllItemFields(item: ContextItem, context: PrintContext): Record<ItemFieldKey, FieldValue> {
  const out = {} as Record<ItemFieldKey, FieldValue>;
  for (const key of ITEM_FIELD_KEYS) out[key] = resolveItemField(key, item, context);
  return out;
}
