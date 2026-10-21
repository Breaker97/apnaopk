/**
 * Bindings (docs/INVOICE_TEMPLATE_BUILDER.md §4.3, §4.7.2): what a text-like
 * element prints for a context. Fixed text prints as it is. A data field
 * resolves through the registry and is formatted by its value type; `null`
 * prints the fallback, or nothing, and skips the before/after text.
 *
 * Also the labels blocks print when the designer gave none: the registry's
 * own, in the template's language.
 *
 * Client-safe.
 */
import type { PrintContext } from "./context-types";
import type { FieldKey, ItemFieldKey } from "./field-keys";
import { getField, getItemField, itemsSummary, resolveField, resolveItemField, tendersText } from "./fields";
import { formatAmount, formatFieldValue, type ValueFormatOptions } from "./formats";
import type { ContextItem } from "./context-types";
import type { ElementBinding, PriceSummaryRow, TemplateLocale } from "./types";

export type BindingOptions = Omit<ValueFormatOptions, "currency">;

/**
 * A field's value before formatting. Two list fields embed amounts in their
 * text; they are rebuilt here with the template's amount format ("Cash:
 * ৳5,775", not "Cash: 5775"). Digits are converted afterwards, with the rest.
 */
function fieldValue(key: FieldKey, context: PrintContext, options: BindingOptions) {
  const money = (value: number) =>
    formatAmount(value, { currency: context.money.currency, format: { ...options.format, digits: "latin" } });
  if (key === "pos.tenders") return context.pos ? tendersText(context.pos.tenders, money) : null;
  if (key === "items.summary") return itemsSummary(context.items, money);
  return resolveField(key, context);
}

/** The text an element prints, or null when nothing should print. */
export function resolveBinding(binding: ElementBinding | undefined, context: PrintContext, options: BindingOptions): string | null {
  if (!binding) return null;
  if (binding.mode === "fixed") {
    const text = binding.text ?? "";
    return text === "" ? null : text;
  }
  if (!binding.field) return binding.fallback || null;
  const value = fieldValue(binding.field, context, options);
  const formatted = formatFieldValue(value, getField(binding.field).valueType, { ...options, currency: context.money.currency });
  if (formatted === null || formatted === "") return binding.fallback || null;
  return `${binding.before ?? ""}${formatted}${binding.after ?? ""}`;
}

/** A field's printed value (no before/after), or null. */
export function fieldText(key: FieldKey, context: PrintContext, options: BindingOptions): string | null {
  const value = fieldValue(key, context, options);
  const formatted = formatFieldValue(value, getField(key).valueType, { ...options, currency: context.money.currency });
  return formatted === "" ? null : formatted;
}

/** An item column's printed value, or null. */
export function itemFieldText(key: ItemFieldKey, item: ContextItem, context: PrintContext, options: BindingOptions): string | null {
  const value = resolveItemField(key, item, context);
  const formatted = formatFieldValue(value, getItemField(key).valueType, { ...options, currency: context.money.currency });
  return formatted === "" ? null : formatted;
}

export function fieldLabel(key: FieldKey, locale: TemplateLocale): string {
  return getField(key).label[locale];
}

export function itemFieldLabel(key: ItemFieldKey, locale: TemplateLocale): string {
  return getItemField(key).label[locale];
}

/** The money field behind each price-summary row. */
export const PRICE_ROW_FIELD: Record<PriceSummaryRow["key"], FieldKey> = {
  subtotal: "money.subtotal",
  discount: "money.discount",
  delivery: "money.delivery",
  tax: "money.tax",
  duty: "money.duty",
  total: "money.total",
  paid: "money.paid",
  due: "money.due",
};

export function priceRowLabel(key: PriceSummaryRow["key"], locale: TemplateLocale): string {
  return fieldLabel(PRICE_ROW_FIELD[key], locale);
}

export function priceRowValue(key: PriceSummaryRow["key"], context: PrintContext): number {
  const value = context.money[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const TAX_MODE_WORDS: Record<"included" | "exempt", Record<TemplateLocale, string>> = {
  included: { en: "included", bn: "অন্তর্ভুক্ত" },
  exempt: { en: "exempt", bn: "অব্যাহতি" },
};

/**
 * How the tax row reads, so the paper adds up the way the till's receipt
 * does: tax added on top is a plain row; tax inside the prices is marked
 * "(included)" and is not added; an exempt sale's row says "(exempt)", with
 * its reason, and the tax it was spared comes off (shown as a deduction,
 * and shown even at zero, since the exemption itself is the information).
 */
export function priceTaxRow(
  label: string,
  context: Pick<PrintContext, "money" | "pos">,
  locale: TemplateLocale,
): { label: string; deduction: boolean; keepAtZero: boolean } {
  const mode = context.money.taxMode;
  if (mode === "included") return { label: `${label} (${TAX_MODE_WORDS.included[locale]})`, deduction: false, keepAtZero: false };
  if (mode === "exempt") {
    const reason = context.pos?.taxExemptReason?.trim();
    return { label: `${label} (${TAX_MODE_WORDS.exempt[locale]})${reason ? ` · ${reason}` : ""}`, deduction: true, keepAtZero: true };
  }
  return { label, deduction: false, keepAtZero: false };
}

const PAID_STAMP: Record<TemplateLocale, string> = { en: "PAID", bn: "পরিশোধিত" };
const MORE_ROWS: Record<TemplateLocale, (n: number) => string> = { en: (n) => `+ ${n} more`, bn: (n) => `+ আরও ${n}টি` };
const PCS: Record<TemplateLocale, string> = { en: "pcs", bn: "পিস" };

export const BLOCK_WORDS = { paidStamp: PAID_STAMP, moreRows: MORE_ROWS, pcs: PCS };
