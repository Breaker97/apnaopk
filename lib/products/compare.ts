import type { Locale } from "@/config/i18n.config";
import type { ProductPriceSummary } from "./price-display";

/**
 * The comparison table's pure shape logic.
 *
 * Kept free of React and of the data layer so the two rules that actually
 * matter — how many products a comparison holds, and how their attribute
 * sets become one aligned set of rows — can be pinned without a database or
 * a renderer.
 */

/**
 * How many columns the table holds. Four is what stays readable on a
 * laptop; past that the value column is narrower than the words in it, and
 * the page stops being a comparison and becomes a spreadsheet.
 */
export const MAX_COMPARE_PRODUCTS = 4;

/** The query key the page reads its selection from. */
const COMPARE_PARAM = "products";

/**
 * A column's worth of product. Price fields are the RAW numbers, never a
 * formatted string: the table formats through `useCurrency` like every
 * other storefront price, so a currency switch reprices the comparison
 * without a refetch.
 */
export interface CompareProduct extends ProductPriceSummary {
  /** Sold by quote — the column prints no money. */
  priceOnRequest?: boolean;
  id: string;
  slug: string;
  name: string;
  image?: string;
  rating: number;
  reviewCount: number;
  attributes: { name: string; value: string }[];
}

interface CompareRow {
  label: string;
  /** One entry per product, in column order; "" where that product is silent. */
  values: string[];
}

/**
 * Parse the `?products=` selection: comma-separated slugs, de-duplicated in
 * place (order is the column order the shopper built) and capped.
 */
export function parseCompareSelection(raw: unknown): string[] {
  const source =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw.filter((entry): entry is string => typeof entry === "string").join(",")
        : "";
  const slugs = source
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
  return Array.from(new Set(slugs)).slice(0, MAX_COMPARE_PRODUCTS);
}

/** The href for the same page with one slug added (a no-op when full). */
export function buildCompareHref(
  locale: Locale | string,
  selection: string[],
  change: { add?: string; remove?: string },
): string {
  let next = selection;
  if (change.remove) next = next.filter((slug) => slug !== change.remove);
  if (change.add && !next.includes(change.add)) {
    next = [...next, change.add].slice(0, MAX_COMPARE_PRODUCTS);
  }
  const base = `/${locale}/compare`;
  return next.length
    ? `${base}?${COMPARE_PARAM}=${next.map(encodeURIComponent).join(",")}`
    : base;
}

/**
 * Align the products' attribute lists into one row set.
 *
 * Rows appear in the order the FIRST product introduces them, then any the
 * later ones add — so the leftmost column reads top-to-bottom exactly as its
 * own spec sheet does, and nothing a shopper picked is dropped for being
 * absent from the others. Labels are matched case-insensitively because
 * "Display size" and "Display Size" are the same row to a shopper.
 */
export function buildCompareRows(products: CompareProduct[]): CompareRow[] {
  const order: string[] = [];
  const labels = new Map<string, string>();
  const byProduct = products.map((product) => {
    const lookup = new Map<string, string>();
    for (const attribute of product.attributes) {
      const label = attribute.name.trim();
      const value = attribute.value.trim();
      if (!label || !value) continue;
      const key = label.toLowerCase();
      // First writer wins within one product: a duplicated attribute is a
      // data entry slip, and silently showing the later one reads as random.
      if (!lookup.has(key)) lookup.set(key, value);
      if (!labels.has(key)) {
        labels.set(key, label);
        order.push(key);
      }
    }
    return lookup;
  });

  return order.map((key) => ({
    label: labels.get(key)!,
    values: byProduct.map((lookup) => lookup.get(key) ?? ""),
  }));
}
