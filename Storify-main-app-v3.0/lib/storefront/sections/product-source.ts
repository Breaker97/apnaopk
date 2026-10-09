import { PRODUCT_TARGET_SOURCES } from "@/lib/site-config/home-page-config";
import type { Field } from "./types";

/**
 * The picked-resource sources of the product shelves — a category, a brand or
 * a collection — as settings. Shared by the section definitions, the editor,
 * the loaders and GET /api/product-cards, so each reads a shelf's pick the
 * same way. Client-safe: no database, no server-only imports.
 */

export type ProductTargetSource = (typeof PRODUCT_TARGET_SOURCES)[number];

/** The setting each picked-resource source keeps its pick in. */
export const PRODUCT_SOURCE_TARGET_KEYS = {
  category: "categoryId",
  brand: "brandId",
  collection: "collectionId",
} as const satisfies Record<ProductTargetSource, string>;

export type ProductSourceTargetKey =
  (typeof PRODUCT_SOURCE_TARGET_KEYS)[ProductTargetSource];

export function isProductTargetSource(
  source: unknown,
): source is ProductTargetSource {
  return (
    typeof source === "string" &&
    (PRODUCT_TARGET_SOURCES as readonly string[]).includes(source)
  );
}

/**
 * The id the shelf's CURRENT source reads, or "" when the source picks
 * nothing or nothing is picked yet.
 *
 * Only the setting that belongs to the source is read. Switching a shelf from
 * a category to a brand leaves the category id stored — the editor only hides
 * its control, so switching back brings it back — and this is what keeps that
 * left-behind value from ever reaching a query.
 */
export function productSourceTarget(settings: Record<string, unknown>): string {
  const source = settings.source;
  if (!isProductTargetSource(source)) return "";
  const value = settings[PRODUCT_SOURCE_TARGET_KEYS[source]];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A shelf whose source waits on a pick that has not been made: a category,
 * brand or collection source with nothing chosen. It draws nothing (and its
 * skeleton is skipped), exactly like a hand-picked shelf with no products.
 */
export function isProductTargetUnpicked(settings: Record<string, unknown>): boolean {
  return isProductTargetSource(settings.source) && !productSourceTarget(settings);
}

const TARGET_HINTS: Record<ProductTargetSource, string> = {
  category:
    "Products from this category and every category below it, newest first.",
  brand: "This brand's products, newest first.",
  collection: "The collection's products, in the collection's own order.",
};

/**
 * The three pick fields a product shelf declares after its source select,
 * each shown only while its source is chosen. The values are ids; an empty
 * one means nothing is picked yet.
 */
export function productSourceTargetFields(): Field[] {
  return [
    {
      key: PRODUCT_SOURCE_TARGET_KEYS.category,
      type: "category",
      hint: TARGET_HINTS.category,
      showWhen: { key: "source", values: ["category"] },
    },
    {
      key: PRODUCT_SOURCE_TARGET_KEYS.brand,
      type: "brand",
      hint: TARGET_HINTS.brand,
      showWhen: { key: "source", values: ["brand"] },
    },
    {
      key: PRODUCT_SOURCE_TARGET_KEYS.collection,
      type: "collection",
      hint: TARGET_HINTS.collection,
      showWhen: { key: "source", values: ["collection"] },
    },
  ];
}
