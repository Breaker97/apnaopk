import { type Locale } from "@/config/i18n.config";
import {
  NEW_ARRIVALS_LIMIT_MAX,
  NEW_ARRIVALS_LIMIT_MIN,
} from "@/lib/site-config/home-page-config";
import {
  getStorefrontProductCards,
  type StorefrontProductCardQuery,
} from "@/lib/products/storefront-product-cards";
import {
  ProductGroupTabs,
  type ProductGroupAppearance,
  type ProductGroupTab,
} from "./product-group-tabs";

export const PRODUCT_GROUP_SOURCES = [
  "latest",
  "featured",
  "discounted",
  "manual",
] as const;
export type ProductGroupSource = (typeof PRODUCT_GROUP_SOURCES)[number];

interface ProductGroupTabInput {
  id: string;
  label: string;
  source: ProductGroupSource;
  productIds: string[];
}

function buildQuery(
  source: ProductGroupSource,
  productIds: string[],
  limit: number,
): StorefrontProductCardQuery | null {
  if (source === "manual") {
    const ids = productIds.filter(Boolean);
    if (ids.length === 0) return null;
    return { ids, limit: Math.min(ids.length, limit) };
  }
  const query: StorefrontProductCardQuery = {
    limit,
    sortBy: "createdAt",
    sortOrder: "desc",
  };
  if (source === "discounted") query.onSale = true;
  if (source === "featured") query.featured = true;
  return query;
}

/**
 * Server half of the tabbed product group ("Best Selling"-style): fetches
 * every tab's products up front (each tab query goes through the shared
 * cached card fetcher), then hands the lot to the client tab switcher.
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
  const perTab = Math.min(
    NEW_ARRIVALS_LIMIT_MAX,
    Math.max(NEW_ARRIVALS_LIMIT_MIN, Math.floor(limit ?? 8) || 8),
  );
  const resolved: ProductGroupTab[] = (
    await Promise.all(
      tabs.map(async (tab) => {
        const query = buildQuery(tab.source, tab.productIds, perTab);
        const products = query ? await getStorefrontProductCards(query) : [];
        return { id: tab.id, label: tab.label, products };
      }),
    )
  ).filter((tab) => tab.label && tab.products.length > 0);

  if (resolved.length === 0) return null;

  return (
    <ProductGroupTabs
      locale={locale}
      title={title}
      tabs={resolved}
      appearance={appearance}
      desktopColumns={desktopColumns}
    />
  );
}
