/**
 * The render context (docs/INVOICE_TEMPLATE_BUILDER.md §4.7.1): the plain,
 * whitelisted object a template is filled from. `buildOrderContext` (server),
 * `buildPosContext` (the till) and `sampleContext` (the editor) all produce
 * it, and the renderer, the field registry and the print routes read nothing
 * else — no order document, no settings, no credentials ever reach a template.
 *
 * Every piece of missing data is `null`, never `undefined` or `NaN`, so a
 * bound field prints its fallback or nothing (§4.7.2). Dates travel as ISO
 * strings and money as plain numbers in `money.currency`; the template's
 * formats (Phase 2) turn them into text.
 *
 * Client-safe: types only.
 */
import type { TemplateCategory, TemplateLocale } from "./types";

/** A printed value that may be missing. */
export type ContextText = string | null;

/** The printing business: the platform, or the vendor when a vendor prints. */
export interface ContextStore {
  name: ContextText;
  phone: ContextText;
  email: ContextText;
  /** One line; the renderer wraps it. */
  address: ContextText;
  /** An image URL from the store's own assets. */
  logo: ContextText;
  website: ContextText;
  facebook: ContextText;
  /**
   * The store's tax registration as printed: "Sales tax permit 123-456789".
   * The platform's, from Settings → Tax Settings; null for a vendor's print
   * and for a store that has not entered one.
   */
  taxId: ContextText;
}

export interface ContextOrder {
  /** The order number; an offline POS sale prints its local receipt number. */
  number: string;
  /** ISO 8601, or null when the order carries no date. */
  date: ContextText;
  /**
   * The stored value (`paid`, `pending`, …); `fields.ts` labels it. A
   * consignment's print carries the consignment's own status, not the order's.
   */
  paymentStatus: ContextText;
  /** The stored value (`cod`, `stripe`, …) or, for a POS sale, its tender methods joined by `+`. */
  paymentMethod: ContextText;
  customerNote: ContextText;
  /**
   * Staff-only. Null unless the context was built for a template that prints
   * it (admin route only); a vendor's context never carries it (§4.14).
   */
  internalNote: ContextText;
  /** Who took the order: the cashier, or the staff member who placed it. */
  takenBy: ContextText;
  channel: "online" | "pos";
}

export interface ContextCustomer {
  name: ContextText;
  phone: ContextText;
  email: ContextText;
  /** The delivery address line by line, placeholders removed; empty when there is none. */
  addressLines: string[];
}

export interface ContextItem {
  name: string;
  /** The variant as sold (D-04); null on orders from before the snapshot. */
  variant: ContextText;
  colour: ContextText;
  size: ContextText;
  sku: ContextText;
  qty: number;
  unitPrice: number;
  /** The struck-through price the shopper saw, when there was one. */
  compareAtPrice: number | null;
  lineDiscount: number;
  /** `unitPrice × qty − lineDiscount` (§4.7.3). */
  lineTotal: number;
  image: ContextText;
  /** "0.5 kg"; null when the line has no weight. */
  weight: ContextText;
  note: ContextText;
  /**
   * The line's tax rate (percent) and tax, as the order recorded them
   * (lib/tax/tax-parts.ts); null when it recorded none for the line.
   */
  taxRate: number | null;
  tax: number | null;
  /** `lineTotal` with its tax when the tax is added on top; null without it. */
  totalWithTax: number | null;
}

export type ContextTaxMode = "added" | "included" | "exempt";

export interface ContextMoney {
  /** `order.currency` (§4.7.3). */
  currency: string;
  subtotal: number;
  discount: number;
  delivery: number;
  tax: number;
  /**
   * How the tax relates to the figures printed with it: added on top, inside
   * the prices, or waived (POS). "included" only when the subtotal is at
   * tax-inclusive shelf prices (a whole POS sale); a consignment's figures are
   * net, so its tax is "added" even on a tax-inclusive sale.
   */
  taxMode: ContextTaxMode;
  duty: number;
  total: number;
  /** Paid so far (the "advance" on a COD or deposit order). */
  paid: number;
  due: number;
  /** Cash to collect at the door: `due` on a COD order, otherwise 0. */
  cod: number;
  refunded: number;
}

export interface ContextDelivery {
  method: ContextText;
  courier: ContextText;
  service: ContextText;
  trackingNumber: ContextText;
  trackingUrl: ContextText;
  /** The consignment's vendor store, on a multi-vendor order. */
  seller: ContextText;
  /** Whether the consignment's label is the store's own or carrier-issued (D-09). */
  labelSource: "internal" | "carrier" | null;
}

export interface ContextTender {
  label: string;
  amount: number;
}

export interface ContextPos {
  counter: ContextText;
  cashier: ContextText;
  tenders: ContextTender[];
  cashTendered: number | null;
  change: number | null;
  taxExemptReason: ContextText;
}

export interface ContextPage {
  number: number;
  count: number;
}

/** Which part of the order this context covers. */
export interface ContextConsignment {
  /** The consignment id, or null when the context spans several consignments. */
  id: ContextText;
  /** 1-based position among the order's consignments (0 when several). */
  index: number;
  /** How many consignments the order has. */
  count: number;
}

export interface PrintContext {
  category: TemplateCategory;
  /** The language of generated labels ("Pickup", "Page 1 of 3"). */
  locale: TemplateLocale;
  /** True for the editor's sample data; a sample never writes anything either. */
  isSample: boolean;
  store: ContextStore;
  order: ContextOrder;
  customer: ContextCustomer;
  items: ContextItem[];
  money: ContextMoney;
  delivery: ContextDelivery;
  /** Only for a POS sale. */
  pos: ContextPos | null;
  /** Set per page by pagination (Phase 2); `{ 1, 1 }` until then. */
  page: ContextPage;
  /** Null when the context is the whole order. */
  consignment: ContextConsignment | null;
}
