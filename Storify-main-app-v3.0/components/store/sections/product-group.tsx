import { type Locale } from "@/config/i18n.config";
import { productGroupSearchParams } from "@/lib/storefront/sections/product-group-query";
import {
  loadProductGroupTabs,
  type ProductGroupTabInput,
} from "@/lib/storefront/section-data/product-group";
import { ProductGroupTabsLazy as ProductGroupTabs } from "./product-group-tabs-lazy";
import type {
  ProductGroupAppearance,
  ProductGroupTab,
} from "./product-group-tabs";
import { productTabsEmptyState } from "./product-source-empty-state";

/**
 * Server half of the tabbed product group ("Best Selling"-style). Every tab is
 * queried — through the shared source resolver — so an empty one can be left
 * out, but only the first tab's products travel with the page: the others
 * were a third of the home page's inline data for rows nobody had opened. The
 * client fetches them once the page is idle, or when a tab is reached for,
 * with a request that names the tab's own source and pick.
 *
 * In the builder's preview, the tabs left out for want of products are named
 * with the reason, under the tabs that do show — or alone, when none does.
 */
export async function ProductGroup({
  locale,
  title,
  tabs,
  appearance,
  limit,
  desktopColumns,
  preview = false,
  vendor,
}: {
  locale: Locale;
  title: string;
  tabs: ProductGroupTabInput[];
  appearance?: ProductGroupAppearance;
  /** Products fetched per tab; clamped to the shared shelf bounds. */
  limit?: number;
  /** Cards sharing the visible row on desktop; the tabs component clamps. */
  desktopColumns?: number;
  /** The builder's preview: hidden tabs are named, with why. */
  preview?: boolean;
  /** A vendor's landing page: every tab lists that store's products alone. */
  vendor?: { id: string; slug: string };
}) {
  const { perTab, tabs: resolved, skipped } = await loadProductGroupTabs({
    tabs,
    limit,
    ...(vendor ? { vendor } : {}),
  });

  // Only tabs with a picked category, brand or collection are named: a tab
  // of the shelf's own sources previews exactly as it always did.
  const hiddenNote = await productTabsEmptyState(
    { preview },
    {
      locale,
      hidden: skipped.flatMap(({ tab, missing }) =>
        missing === "none" ? [] : [{ label: tab.label, source: tab.source, missing }],
      ),
      someShown: resolved.length > 0,
    },
  );

  if (resolved.length === 0) return hiddenNote;

  const shelfTabs: ProductGroupTab[] = resolved.map(({ tab, products }, index) => ({
    id: tab.id,
    label: tab.label,
    ...(index === 0 ? { products } : {}),
    query: productGroupSearchParams(tab, perTab, vendor?.id),
  }));

  const shelf = (
    <ProductGroupTabs
      locale={locale}
      title={title}
      tabs={shelfTabs}
      appearance={appearance}
      desktopColumns={desktopColumns}
    />
  );

  return hiddenNote ? (
    <>
      {shelf}
      {hiddenNote}
    </>
  ) : (
    shelf
  );
}
