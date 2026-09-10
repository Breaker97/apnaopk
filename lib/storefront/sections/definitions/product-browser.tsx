import { HomeProductsSection } from "@/components/store/home-products-section";
import { FeaturedProductsSkeleton } from "@/components/store/home-section-skeletons";
import {
  FEATURED_PRODUCTS_SOURCES,
  NEW_ARRIVALS_COLUMNS_MAX,
  NEW_ARRIVALS_COLUMNS_MIN,
  PRODUCT_BROWSER_LAYOUTS,
  PRODUCT_BROWSER_ROWS_MAX,
  PRODUCT_BROWSER_ROWS_MIN,
  type FeaturedProductsSource,
  type ProductBrowserLayout,
} from "@/lib/site-config/home-page-config";
import { lt } from "../localized";
import type {
  LocalizedText,
  SectionDefinition,
  SectionInstance,
} from "../types";

/**
 * v1 → v2: the raw product `limit` became a ROW count. A count that did not
 * divide by the column count left a ragged last row — eight cards across
 * five columns is a full row and three orphans — so the shelf now sizes
 * itself in whole rows. The migration keeps roughly the shelf a merchant
 * had: however many rows their old count filled.
 */
function migrateProductBrowserV1(instance: SectionInstance): SectionInstance {
  const settings = instance.settings ?? {};
  if (typeof settings.rows === "number") {
    return { ...instance, version: 2 };
  }
  const columns =
    typeof settings.desktopColumns === "number" && settings.desktopColumns > 0
      ? Math.floor(settings.desktopColumns)
      : 4;
  const limit =
    typeof settings.limit === "number" && settings.limit > 0
      ? Math.floor(settings.limit)
      : 8;
  const { limit: _dropped, ...rest } = settings;
  return {
    ...instance,
    version: 2,
    settings: {
      ...rest,
      rows: Math.min(
        PRODUCT_BROWSER_ROWS_MAX,
        Math.max(PRODUCT_BROWSER_ROWS_MIN, Math.round(limit / columns)),
      ),
    },
  };
}

/**
 * The catalogue browser (legacy "Featured Products"): in its default "all"
 * source it renders the category-chip grid with infinite scroll; curated
 * sources render a plain shelf. A distinct type from product-grid because
 * the components — and the merchandising job — are different.
 */
export const productBrowser: SectionDefinition = {
  type: "product-browser",
  version: 2,
  category: "products",
  fields: [
    { key: "title", type: "text", translatable: true, default: "" },
    {
      key: "source",
      type: "select",
      options: FEATURED_PRODUCTS_SOURCES,
      default: "all",
    },
    // Browser: category chips, filters and endless scroll — the catalogue
    // page's own chrome. Grid: the same cards, nothing around them.
    {
      key: "layout",
      type: "select",
      options: PRODUCT_BROWSER_LAYOUTS,
      default: "browser",
    },
    {
      key: "rows",
      type: "number",
      default: 2,
      min: PRODUCT_BROWSER_ROWS_MIN,
      max: PRODUCT_BROWSER_ROWS_MAX,
    },
    // Same knob, same bounds as the product-grid and product-group sections.
    {
      key: "desktopColumns",
      type: "number",
      default: 4,
      min: NEW_ARRIVALS_COLUMNS_MIN,
      max: NEW_ARRIVALS_COLUMNS_MAX,
    },
    {
      key: "productIds",
      type: "productList",
      hint: "Drag to set the order they appear in.",
      showWhen: { key: "source", values: ["manual"] },
    },
  ],
  migrate: migrateProductBrowserV1,
  Render({ settings, ctx }) {
    const title = lt(
      settings.title as LocalizedText,
      ctx.locale,
      ctx.defaultLanguage,
    );
    return (
      <HomeProductsSection
        locale={ctx.locale}
        title={title || undefined}
        source={settings.source as FeaturedProductsSource}
        rows={settings.rows as number}
        desktopColumns={settings.desktopColumns as number}
        productIds={settings.productIds as string[]}
        layout={settings.layout as ProductBrowserLayout}
        preview={ctx.preview}
      />
    );
  },
  Skeleton: ({ settings }) => (
    <FeaturedProductsSkeleton desktopColumns={settings.desktopColumns as number} />
  ),
};
