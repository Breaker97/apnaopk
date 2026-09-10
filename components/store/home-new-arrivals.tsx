import { type Locale } from "@/config/i18n.config";
import { HomeNewArrivalsCarousel } from "@/components/store/home-new-arrivals-carousel";
import { type ModernProduct } from "@/components/products/modern-product-card";
import {
  getStorefrontProductCards,
  type StorefrontProductCardQuery,
} from "@/lib/products/storefront-product-cards";
import {
  NEW_ARRIVALS_COLUMNS_MAX,
  NEW_ARRIVALS_COLUMNS_MIN,
  NEW_ARRIVALS_LIMIT_MAX,
  NEW_ARRIVALS_LIMIT_MIN,
  type NewArrivalsSource,
} from "@/lib/site-config/home-page-config";

async function fetchProducts(
  query: StorefrontProductCardQuery,
): Promise<ModernProduct[]> {
  return getStorefrontProductCards(query);
}

function buildSourceQuery(
  source: NewArrivalsSource,
  limit: number,
  productIds: string[],
): StorefrontProductCardQuery | null {
  if (source === "manual") {
    const ids = productIds.filter(Boolean);
    if (ids.length === 0) return null;
    return {
      ids,
      limit: Math.min(ids.length, NEW_ARRIVALS_LIMIT_MAX),
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

function buildLatestQuery(limit: number): StorefrontProductCardQuery {
  return {
    limit,
    sortBy: "createdAt",
    sortOrder: "desc",
  };
}

export async function HomeNewArrivals({
  locale,
  title,
  subtitle,
  source = "discounted",
  limit = 8,
  desktopColumns = 4,
  productIds = [],
}: {
  locale: Locale;
  title?: string;
  subtitle?: string;
  source?: NewArrivalsSource;
  limit?: number;
  desktopColumns?: number;
  productIds?: string[];
}) {
  const safeLimit = Math.min(
    NEW_ARRIVALS_LIMIT_MAX,
    Math.max(NEW_ARRIVALS_LIMIT_MIN, Math.floor(limit) || 8),
  );
  const normalizedDesktopColumns = Number.isFinite(desktopColumns)
    ? Math.floor(desktopColumns)
    : 4;
  const safeDesktopColumns = Math.min(
    NEW_ARRIVALS_COLUMNS_MAX,
    Math.max(NEW_ARRIVALS_COLUMNS_MIN, normalizedDesktopColumns),
  );

  const sourceQuery = buildSourceQuery(source, safeLimit, productIds);
  let products = sourceQuery ? await fetchProducts(sourceQuery) : [];

  // Confirmed fallback: when the chosen logic yields nothing, show latest
  // products so the section is never empty.
  if (products.length === 0 && source !== "latest") {
    products = await fetchProducts(buildLatestQuery(safeLimit));
  }

  if (products.length === 0) return null;

  return (
    <HomeNewArrivalsCarousel
      locale={locale}
      products={products.slice(0, safeLimit)}
      title={title}
      subtitle={subtitle}
      desktopColumns={safeDesktopColumns}
      viewAllHref={buildViewAllHref(locale)}
    />
  );
}

// "View all" href. The catalog page reads only category/brand/collection/
// search/price/sort, so there is no on-sale or featured filter to carry over —
// every source lands on the catalog, sorted newest to match the carousel's own
// ordering.
function buildViewAllHref(locale: Locale): string {
  return `/${locale}/products?sortBy=createdAt`;
}
