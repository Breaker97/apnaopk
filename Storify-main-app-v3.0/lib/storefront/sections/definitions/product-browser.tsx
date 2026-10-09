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
import {
  isProductTargetUnpicked,
  productSourceTargetFields,
} from "../product-source";
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
 * v2 → v3: the browser layout stops at its rows unless "Endless scroll" is
 * on. Before, it always scrolled on, its rows only the size of each load, so
 * a shelf saved then keeps doing that until the merchant turns it off.
 */
function migrateProductBrowserV2(instance: SectionInstance): SectionInstance {
  const settings = instance.settings ?? {};
  return {
    ...instance,
    version: 3,
    settings:
      typeof settings.endless === "boolean"
        ? settings
        : // Only the browser scrolled on; the plain grid always stopped.
          { ...settings, endless: settings.layout !== "plain" },
  };
}

function migrateProductBrowser(instance: SectionInstance, from: number): SectionInstance {
  const v2 = from < 2 ? migrateProductBrowserV1(instance) : instance;
  return migrateProductBrowserV2(v2);
}

/**
 * The catalogue browser (legacy "Featured Products"): in its default "all"
 * source it renders the category-chip grid, which stops at its rows or, with
 * "Endless scroll" on, loads more as the shopper scrolls; curated sources
 * render a plain shelf. A distinct type from product-grid because the
 * components — and the merchandising job — are different.
 */
export const productBrowser: SectionDefinition = {
  type: "product-browser",
  version: 3,
  category: "products",
  fields: [
    { key: "title", type: "text", translatable: true, default: "" },
    {
      key: "source",
      type: "select",
      options: FEATURED_PRODUCTS_SOURCES,
      default: "all",
    },
    // The picked category, brand or collection — each shown only for its
    // source, and only the current source's is ever read. Those sources are
    // one fixed shelf in either layout, never the endless browser.
    ...productSourceTargetFields(),
    // Browser: category chips, filters and endless scroll — the catalogue
    // page's own chrome. Grid: the same cards, nothing around them.
    {
      key: "layout",
      type: "select",
      options: PRODUCT_BROWSER_LAYOUTS,
      default: "browser",
    },
    {
      key: "endless",
      type: "toggle",
      default: false,
      hint: "Keep loading products as shoppers scroll. Off, the grid stops after its rows, with a View all link.",
      showWhen: { key: "layout", values: ["browser"] },
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
  migrate: migrateProductBrowser,
  // A category, brand or collection source with nothing picked draws nothing.
  isEmpty: ({ settings }) => isProductTargetUnpicked(settings),
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
        categoryId={settings.categoryId as string}
        brandId={settings.brandId as string}
        collectionId={settings.collectionId as string}
        layout={settings.layout as ProductBrowserLayout}
        endless={settings.endless === true}
        preview={ctx.preview}
        // A vendor's landing page browses that store's catalogue alone.
        vendor={ctx.vendor}
      />
    );
  },
  Skeleton: ({ settings }) => (
    <FeaturedProductsSkeleton desktopColumns={settings.desktopColumns as number} />
  ),
};
