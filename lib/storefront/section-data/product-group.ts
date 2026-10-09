import "server-only";

import type { ModernProduct } from "@/lib/products/modern-product";
import {
  buildProductGroupQuery,
  productGroupLimit,
  type ProductGroupTabSource,
} from "@/lib/storefront/sections/product-group-query";
import {
  resolveProductSource,
  type ProductSelection,
  type ProductSourceMissing,
  type ProductSourceVendor,
} from "./product-source";

/** One tab of a tabbed product group, as the merchant set it up. */
export interface ProductGroupTabInput extends ProductGroupTabSource {
  id: string;
  label: string;
}

/**
 * One tab's products through the shared source resolver: the section's first
 * tab, and every tab GET /api/product-cards answers, read the same way.
 */
export function loadProductGroupTab(
  tab: ProductGroupTabSource,
  perTab: number,
  /** A vendor's landing page: the tab reads that store's products alone. */
  vendor?: ProductSourceVendor,
): Promise<ProductSelection> {
  return resolveProductSource(tab, {
    limit: perTab,
    curatedQuery: (source) => buildProductGroupQuery(source, tab.productIds, perTab),
    ...(vendor ? { vendor } : {}),
  });
}

/**
 * The tabbed product group ("Best Selling"): every tab's products, through
 * the shared cached card reader. A tab without a label or without products is
 * left out; no tab left means nothing to draw. `skipped` names the tabs left
 * out for want of products, and why, for the builder's preview.
 */
export async function loadProductGroupTabs(options: {
  tabs: ProductGroupTabInput[];
  limit: number | undefined;
  vendor?: ProductSourceVendor;
}): Promise<{
  perTab: number;
  tabs: { tab: ProductGroupTabInput; products: ModernProduct[]; href?: string }[];
  skipped: { tab: ProductGroupTabInput; missing: ProductSourceMissing | "none" }[];
}> {
  const perTab = productGroupLimit(options.limit);
  const resolved = await Promise.all(
    options.tabs.map(async (tab) => ({
      tab,
      ...(await loadProductGroupTab(tab, perTab, options.vendor)),
    })),
  );
  return {
    perTab,
    tabs: resolved
      .filter(({ tab, products }) => tab.label && products.length > 0)
      .map(({ tab, products, href }) => ({ tab, products, ...(href ? { href } : {}) })),
    skipped: resolved
      .filter(({ products }) => products.length === 0)
      .map(({ tab, missing }) => ({ tab, missing: missing ?? "none" })),
  };
}
