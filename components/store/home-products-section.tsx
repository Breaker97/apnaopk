import { type Locale } from "@/config/i18n.config";
import { type ModernProduct } from "@/components/products/modern-product-card";
import { HomeProductsSectionClient } from "./home-products-section-client";
import { HomeProductsSectionInfinite } from "./home-products-section-infinite";
import { PlainProductGrid } from "./sections/plain-product-grid";
import {
  getStorefrontProductCards,
  type StorefrontProductCardQuery,
} from "@/lib/products/storefront-product-cards";
import { getStorefrontProducts } from "@/lib/products/storefront-products";
import { getStorefrontCategories } from "@/lib/storefront/storefront-categories";
import {
  FEATURED_PRODUCTS_LIMIT_MAX,
  PRODUCT_BROWSER_ROWS_MAX,
  PRODUCT_BROWSER_ROWS_MIN,
  type FeaturedProductsSource,
  type ProductBrowserLayout,
} from "@/lib/site-config/home-page-config";
import { clampDesktopColumns } from "./product-grid-columns";



type ProductCategory =
  | string
  | {
      _id?: string;
      name?: string;
      slug?: string;
    };

type HomeProduct = ModernProduct & {
  category?: ProductCategory;
};

function buildSourceQuery(
  source: Exclude<FeaturedProductsSource, "all">,
  limit: number,
  productIds: string[],
): StorefrontProductCardQuery | null {
  if (source === "manual") {
    const ids = productIds.filter(Boolean);
    if (ids.length === 0) return null;
    return {
      ids,
      limit: Math.min(ids.length, FEATURED_PRODUCTS_LIMIT_MAX),
    };
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

export async function HomeProductsSection({
  locale,
  title,
  source = "all",
  rows = 2,
  desktopColumns = 4,
  productIds = [],
  layout = "browser",
  preview = false,
}: {
  locale: Locale;
  title?: string;
  source?: FeaturedProductsSource;
  /** Rows of cards; the shelf holds rows × columns, so it is never ragged. */
  rows?: number;
  desktopColumns?: number;
  productIds?: string[];
  layout?: ProductBrowserLayout;
  /**
   * The builder's framed render. The browser layout scrolls on for ever, so
   * no row count is "all of it" — the frame shows the first row and the
   * merchant judges the chrome, not the depth. The plain grid is finite and
   * short, so it previews exactly what it will paint.
   */
  preview?: boolean;
}) {
  const safeDesktopColumns = clampDesktopColumns(desktopColumns);
  const safeRows = Math.min(
    PRODUCT_BROWSER_ROWS_MAX,
    Math.max(PRODUCT_BROWSER_ROWS_MIN, Math.floor(rows) || 2),
  );
  // 1×2 through 4×6 — inside the browser's own 24-card ceiling by
  // construction, so no clamp can reintroduce a partial row.
  const total =
    (preview && layout === "browser" ? 1 : safeRows) * safeDesktopColumns;

  // The plain grid neither filters nor scrolls on, so every source resolves
  // the same way: one page of exactly `total` cards.
  if (layout === "plain") {
    const query =
      source === "all"
        ? ({
            limit: total,
            sortBy: "createdAt",
            sortOrder: "desc",
          } satisfies StorefrontProductCardQuery)
        : buildSourceQuery(source, total, productIds);
    let gridProducts: HomeProduct[] = query
      ? await getStorefrontProductCards(query)
      : [];
    if (gridProducts.length === 0 && source !== "latest") {
      gridProducts = await getStorefrontProductCards({
        limit: total,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
    }
    return (
      <PlainProductGrid
        locale={locale}
        title={title}
        products={gridProducts.slice(0, total)}
        desktopColumns={safeDesktopColumns}
      />
    );
  }

  if (source === "all") {
    const [result, categoryResult] = await Promise.all([
      getStorefrontProducts<HomeProduct>({
        page: 1,
        limit: total,
        sortBy: "createdAt",
        sortOrder: "desc",
        cardFieldsOnly: true,
      }),
      getStorefrontCategories({ flat: true, limit: 50 }),
    ]);

    if (!result.data.length) return null;

    const categories = categoryResult.categories.map((category) => ({
      name: category.name,
      slug: category.slug,
    }));

    return (
      <HomeProductsSectionInfinite
        locale={locale}
        title={title}
        categories={categories}
        initialProducts={result.data}
        initialHasNext={result.pagination.hasNext}
        pageSize={total}
        desktopColumns={safeDesktopColumns}
      />
    );
  }

  const sourceQuery = buildSourceQuery(source, total, productIds);
  let products: HomeProduct[] = sourceQuery
    ? await getStorefrontProductCards(sourceQuery)
    : [];

  // Confirmed fallback: when the chosen logic yields nothing, show the latest
  // products so the section is never empty.
  if (products.length === 0 && source !== "latest") {
    products = await getStorefrontProductCards({
      limit: total,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  }

  if (!products.length) return null;

  return (
    <HomeProductsSectionClient
      locale={locale}
      products={products.slice(0, total)}
      title={title}
      desktopColumns={safeDesktopColumns}
    />
  );
}
