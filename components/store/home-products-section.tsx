import { type Locale } from "@/config/i18n.config";
import {
  HomeProductsSectionClientLazy as HomeProductsSectionClient,
  HomeProductsSectionInfiniteLazy as HomeProductsSectionInfinite,
} from "./home-products-section-lazy";
import { PlainProductGrid } from "./sections/plain-product-grid";
import { productSourceEmptyState } from "./sections/product-source-empty-state";
import {
  type FeaturedProductsSource,
  type ProductBrowserLayout,
} from "@/lib/site-config/home-page-config";
import { loadProductBrowser } from "@/lib/storefront/section-data/product-shelves";
import { isProductTargetSource } from "@/lib/storefront/sections/product-source";

export async function HomeProductsSection({
  locale,
  title,
  source = "all",
  rows = 2,
  desktopColumns = 4,
  productIds = [],
  categoryId,
  brandId,
  collectionId,
  layout = "browser",
  endless = false,
  preview = false,
  vendor,
}: {
  locale: Locale;
  title?: string;
  source?: FeaturedProductsSource;
  /** Rows of cards; the shelf holds rows × columns, so it is never ragged. */
  rows?: number;
  desktopColumns?: number;
  productIds?: string[];
  /** The picked category, brand or collection; only the source's own is read. */
  categoryId?: string;
  brandId?: string;
  collectionId?: string;
  layout?: ProductBrowserLayout;
  /** The browser layout keeps loading past its rows as the shopper scrolls. */
  endless?: boolean;
  /**
   * The builder's framed render. An endless browser scrolls on for ever, so
   * no row count is "all of it" — the frame shows the first row and the
   * merchant judges the chrome, not the depth. A grid that stops at its rows
   * previews exactly what it will paint.
   */
  preview?: boolean;
  /**
   * A vendor's landing page: every source reads that store's products alone,
   * the browser's chips are the store's own categories, and "All
   * Categories" and "View all" open its Products tab.
   */
  vendor?: { id: string; slug: string };
}) {
  const data = await loadProductBrowser({
    ...(vendor ? { vendor } : {}),
    source,
    layout,
    rows,
    desktopColumns,
    productIds,
    endless,
    categoryId,
    brandId,
    collectionId,
    preview,
  });

  // A picked category, brand or collection with nothing to show: hidden on
  // the store, and the builder's preview says why.
  if (data && "missing" in data && data.missing && isProductTargetSource(source)) {
    return productSourceEmptyState({ preview }, { locale, source, missing: data.missing });
  }

  if (data?.kind === "plain") {
    return (
      <PlainProductGrid
        locale={locale}
        title={title}
        products={data.products}
        desktopColumns={data.columns}
      />
    );
  }

  if (!data) return null;

  if (data.kind === "browser") {
    return (
      <HomeProductsSectionInfinite
        locale={locale}
        title={title}
        categories={data.categories}
        initialProducts={data.products}
        initialHasNext={data.hasNext}
        pageSize={data.pageSize}
        maxProducts={data.maxProducts}
        desktopColumns={data.columns}
        vendor={data.vendorSlug}
        {...(data.allCategoriesHref ? { allCategoriesHref: data.allCategoriesHref } : {})}
      />
    );
  }

  return (
    <HomeProductsSectionClient
      locale={locale}
      products={data.products}
      title={title}
      desktopColumns={data.columns}
      {...(vendor
        ? { allCategoriesHref: `/vendors/${encodeURIComponent(vendor.slug)}?tab=products` }
        : {})}
    />
  );
}
