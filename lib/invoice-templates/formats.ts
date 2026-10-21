/**
 * Formats (docs/INVOICE_TEMPLATE_BUILDER.md §4.3 `format`): how an amount,
 * a date and digits print. The template sets them; an element can override
 * any of them (`element.format`). Money is always in the context's currency
 * (`order.currency`, D-05); the symbol comes from the currency, never from
 * the language.
 *
 * Client-safe: used by the renderer on the page, in the preview and on the
 * till.
 */
import { formatCurrency } from "@/lib/intl/money";
import type { FieldValue, FieldValueType } from "./fields";
import { DEFAULT_FORMAT, type ElementFormat, type TemplateFormat, type TemplateLocale } from "./types";

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"] as const;

/** The format an element prints with: the template's, overridden by its own. */
export function effectiveFormat(template: TemplateFormat | undefined, element?: ElementFormat): TemplateFormat {
  const base = { ...DEFAULT_FORMAT, ...template };
  if (!element) return base;
  const out = { ...base };
  if (element.amount) out.amount = element.amount;
  if (element.date) out.date = element.date;
  if (element.digits) out.digits = element.digits;
  if (element.amountSuffix !== undefined) out.amountSuffix = element.amountSuffix;
  return out;
}

/** Latin digits as Bengali ones when the format asks; anything else untouched. */
export function formatDigits(text: string, digits: TemplateFormat["digits"]): string {
  if (digits !== "bengali") return text;
  return text.replace(/[0-9]/g, (digit) => BENGALI_DIGITS[Number(digit)]!);
}

export interface AmountOptions {
  currency: string;
  format: TemplateFormat;
  /** Printed as a deduction: "−৳50". */
  deduction?: boolean;
}

/**
 * An amount as the template prints it: `৳3,150` (symbol), `3150` (plain) or
 * `3150.00` (fixed2), then the suffix, in the chosen digits. Not finite → "".
 */
export function formatAmount(value: number, options: AmountOptions): string {
  if (!Number.isFinite(value)) return "";
  const { format } = options;
  const magnitude = Math.abs(value);
  let text: string;
  if (format.amount === "symbol") {
    // Whole amounts print without decimals (৳3,150); anything else keeps two (৳3,150.50).
    const fraction = Number.isInteger(Number(magnitude.toFixed(2))) ? 0 : 2;
    text = formatCurrency(magnitude, options.currency, "en-US", {
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
    });
  } else if (format.amount === "fixed2") {
    text = magnitude.toFixed(2);
  } else {
    text = String(Number(magnitude.toFixed(2)));
  }
  if (format.amountSuffix) text += format.amountSuffix;
  const negative = value < 0;
  const sign = negative !== Boolean(options.deduction) ? "−" : "";
  return formatDigits(sign + text, format.digits);
}

const MONTHS: Record<TemplateLocale, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  bn: ["জানু", "ফেব্রু", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টে", "অক্টো", "নভে", "ডিসে"],
};

export interface DateOptions {
  format: TemplateFormat;
  locale: TemplateLocale;
  /** An IANA zone for the printed day; the runtime's local zone when absent. */
  timeZone?: string;
}

function dateParts(date: Date, timeZone?: string): { day: number; month: number; year: number } {
  if (!timeZone) return { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() };
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { day: get("day"), month: get("month"), year: get("year") };
}

/** An ISO date as `11 Oct 2026`, `11/10/26`, `11/10/2026` or `10/11/2026`; invalid → null. */
export function formatDate(iso: string | null | undefined, options: DateOptions): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const { day, month, year } = dateParts(date, options.timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  let text: string;
  switch (options.format.date) {
    case "dd/MM/yy":
      text = `${pad(day)}/${pad(month)}/${pad(year % 100)}`;
      break;
    case "dd/MM/yyyy":
      text = `${pad(day)}/${pad(month)}/${year}`;
      break;
    case "M/d/yyyy":
      text = `${month}/${day}/${year}`;
      break;
    default:
      text = `${day} ${MONTHS[options.locale][month - 1]} ${year}`;
  }
  return formatDigits(text, options.format.digits);
}

export interface ValueFormatOptions {
  currency: string;
  format: TemplateFormat;
  locale: TemplateLocale;
  timeZone?: string;
}

/**
 * A field's value as text, by its registry `valueType`: money through the
 * amount format, dates through the date format, numbers and text through the
 * digit set. `null` stays `null` (the fallback, or nothing, prints).
 */
export function formatFieldValue(value: FieldValue, valueType: FieldValueType, options: ValueFormatOptions): string | null {
  if (value === null || value === undefined) return null;
  switch (valueType) {
    case "money":
      return typeof value === "number" ? formatAmount(value, { currency: options.currency, format: options.format }) : formatDigits(String(value), options.format.digits);
    case "date":
      return typeof value === "string" ? formatDate(value, options) : null;
    case "number":
      return formatDigits(typeof value === "number" ? String(Number(value.toFixed(3))) : String(value), options.format.digits);
    case "url":
    case "image":
      return String(value);
    default:
      return formatDigits(String(value), options.format.digits);
  }
}
