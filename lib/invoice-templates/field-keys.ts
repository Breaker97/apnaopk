/**
 * The keys a template element can be bound to (docs/INVOICE_TEMPLATE_BUILDER.md
 * §4.7.2), as data only: the schema validates bindings and product-table
 * columns against these lists, and `fields.ts` (the field registry) gives each
 * key its label, scope, categories, sample and resolver. A key that is not
 * listed here cannot be saved in a template.
 *
 * Client-safe: no model or server import.
 */

/** Single-value fields: any text-like element can print one. */
export const FIELD_KEYS = [
  "order.number",
  "order.date",
  "order.paymentStatus",
  "order.paymentMethod",
  "order.customerNote",
  "order.internalNote",
  "order.takenBy",
  "customer.name",
  "customer.phone",
  "customer.email",
  "customer.address",
  "money.subtotal",
  "money.discount",
  "money.delivery",
  "money.tax",
  "money.duty",
  "money.total",
  "money.paid",
  "money.due",
  "money.cod",
  "delivery.method",
  "delivery.courier",
  "delivery.service",
  "delivery.trackingNumber",
  "delivery.trackingUrl",
  "delivery.seller",
  "items.names",
  "items.skuQtyList",
  "items.summary",
  "items.totalUnits",
  "store.name",
  "store.phone",
  "store.email",
  "store.address",
  "store.logo",
  "store.website",
  "store.facebook",
  "store.taxId",
  "pos.counter",
  "pos.cashier",
  "pos.tenders",
  "pos.cashTendered",
  "pos.change",
  "pos.taxExemptReason",
  "page.number",
  "page.count",
  "page.label",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** Per-line fields: only columns of a product table or product rows print these. */
export const ITEM_FIELD_KEYS = [
  "item.name",
  "item.variant",
  "item.colour",
  "item.size",
  "item.sku",
  "item.qty",
  "item.unitPrice",
  "item.compareAtPrice",
  "item.lineDiscount",
  "item.lineTotal",
  "item.image",
  "item.weight",
  "item.note",
  "item.taxRate",
  "item.tax",
  "item.totalWithTax",
] as const;
export type ItemFieldKey = (typeof ITEM_FIELD_KEYS)[number];

export function isFieldKey(value: unknown): value is FieldKey {
  return typeof value === "string" && (FIELD_KEYS as readonly string[]).includes(value);
}

export function isItemFieldKey(value: unknown): value is ItemFieldKey {
  return typeof value === "string" && (ITEM_FIELD_KEYS as readonly string[]).includes(value);
}
