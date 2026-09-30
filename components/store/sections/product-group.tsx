import { type Locale } from "@/config/i18n.config";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import {
  buildProductGroupQuery,
  productGroupLimit,
  productGroupSearchParams,
  type ProductGroupSource,
} from "@/lib/storefront/sections/product-group-query";
import { ProductGroupTabsLazy as ProductGroupTabs } from "./product-group-tabs-lazy";
import type {
  ProductGroupAppearance,
  ProductGroupTab,
} from "./product-group-tabs";

interface ProductGroupTabInput {
  id: string;
  label: string;
  source: ProductGroupSource;
  productIds: string[];
}

/**
 * Server half of the tabbed product group ("Best Selling"-style). Every tab is
 * queried — through the shared cached card fetcher — so an empty one can be
 * left out, but only the first tab's products travel with the page: the others
 * were a third of the home page's inline data for rows nobody had opened. The
 * client fetches them once the page is idle, or when a tab is reached for.
 */
export async function ProductGroup({
  locale,
  title,
  tabs,
  appearance,
  limit,
  desktopColumns,
}: {
  locale: Locale;
  title: string;
  tabs: ProductGroupTabInput[];
  appearance?: ProductGroupAppearance;
  /** Products fetched per tab; clamped to the shared shelf bounds. */
  limit?: number;
  /** Cards sharing the visible row on desktop; the tabs component clamps. */
  desktopColumns?: number;
}) {
  const perTab = productGroupLimit(limit);
  const resolved = (
    await Promise.all(
      tabs.map(async (tab) => {
        const query = buildProductGroupQuery(tab.source, tab.productIds, perTab);
        const products = query ? await getStorefrontProductCards(query) : [];
        return { tab, products };
      }),
    )
  ).filter(({ tab, products }) => tab.label && products.length > 0);

  if (resolved.length === 0) return null;

  const shelfTabs: ProductGroupTab[] = resolved.map(({ tab, products }, index) => ({
    id: tab.id,
    label: tab.label,
    ...(index === 0 ? { products } : {}),
    query: productGroupSearchParams(tab.source, tab.productIds, perTab),
  }));

  return (
    <ProductGroupTabs
      locale={locale}
      title={title}
      tabs={shelfTabs}
      appearance={appearance}
      desktopColumns={desktopColumns}
    />
  );
}
