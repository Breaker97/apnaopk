import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { WithGridResultCount } from "@/components/products/grid-result-count";
import { type ModernProduct } from "@/components/products/modern-product-card";
import { ProductGrid } from "@/components/products/product-grid";
import { ProductSkeleton } from "@/components/products/product-skeleton";
import { ProductsSort } from "@/components/products/products-sort";
import { PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS } from "@/components/products/products-mobile-toolbar";
import { StickySidebar } from "@/components/ui/sticky-sidebar";
import { FilterSectionLazy } from "@/components/store/sections/themes/electronics-category-filters-lazy";
import { ElectronicsFeaturedProducts } from "@/components/store/sections/themes/electronics-featured-products";
import { ElectronicsListingShell } from "@/components/store/sections/themes/electronics-listing-shell";
import { ElectronicsProductsFiltersLazy, ElectronicsProductsFiltersMobileLazy } from "@/components/store/sections/themes/electronics-products-filters-lazy";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import { normalizeRequestSortBy } from "@/lib/locations/shopper-location";
import {
  getStorefrontProductBrands,
  getStorefrontProductFilters,
} from "@/lib/products/storefront-product-filters";
import { getStorefrontProducts } from "@/lib/products/storefront-products";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { getStorefrontOutOfStockDisplay } from "@/lib/catalog/product-visibility";
import { resolveStockFacet } from "@/lib/catalog/catalog-display";
import type { ProductsTemplateResource } from "@/lib/storefront/sections/types";

/**
 * The Electronics theme's reading of the products template (Figma 759:179):
 * the gradient "Shop All Products" title over the design's faceted sidebar
 * (category / availability / price / brand + the featured strip), the
 * density toolbar, and a PAGED grid with the round-chip pager — where the
 * classic listing scrolls on indefinitely, the design shows numbered pages.
 *
 * Resolved through the theme override table, same contract as
 * `ProductsListing`: it reads only the section's own `heading` setting, so
 * the stored template document renders under every theme and switching back
 * to Classic restores the stock page untouched.
 */

/** Featured minis the sidebar shows below the facets. */
const FEATURED_LIMIT = 4;

/** 8 rows of the design's 4-column grid per page. */
const PAGE_SIZE = 32;

export async function ElectronicsProductsListing({
  locale,
  heading,
  resource,
}: {
  locale: Locale;
  /** Custom heading from the section settings; empty falls back to i18n. */
  heading: string;
  resource: ProductsTemplateResource;
}) {
  const t = await getTranslations({ locale });
  const search = resource.searchParams;
  const location = resource.location;

  const searchQuery =
    typeof search.search === "string" ? search.search : undefined;
  const selectedCategories =
    typeof search.category === "string" ? search.category : "";
  const brand = typeof search.brand === "string" ? search.brand : "";
  const collection =
    typeof search.collection === "string" ? search.collection : undefined;
  const minPrice =
    typeof search.minPrice === "string" ? search.minPrice : undefined;
  const maxPrice =
    typeof search.maxPrice === "string" ? search.maxPrice : undefined;
  const sortBy =
    normalizeRequestSortBy(
      typeof search.sortBy === "string" ? search.sortBy : undefined,
      search,
    ) || "popular";
  const rawPage =
    typeof search.page === "string" ? parseInt(search.page, 10) : 1;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  // Cached getters, resolved together — one round trip, not a waterfall.
  const [
    { categories, priceRange },
    brands,
    featured,
    { headerSettings },
    outOfStockDisplay,
  ] = await Promise.all([
    getStorefrontProductFilters(),
    getStorefrontProductBrands(),
    fetchFeaturedProducts(),
    getStorefrontSettings(),
    getStorefrontOutOfStockDisplay(),
  ]);

  const { showStockFacet, stockParam, stockSet } = resolveStockFacet(
    search.stock,
    outOfStockDisplay,
  );

  // The store's shopper-location switch: the sidebar's Location group is the
  // listing's way in, the header's "Deliver to" the other, and both write
  // through the same storage. Collection is a fulfillment choice and no
  // longer implies a payment one, so the facet is offered wherever location is.
  const showLocation = Boolean(headerSettings.widgets?.showLocationPicker);

  const filterProps = {
    locale,
    categories,
    brands,
    priceRange,
    currentCategories: selectedCategories || undefined,
    currentStock: stockParam || undefined,
    showStockFacet,
    currentBrands: brand || undefined,
    currentMinPrice: minPrice,
    currentMaxPrice: maxPrice,
    showLocation,
    showPickupFacet: showLocation,
    currentPickupNearby: location.pickupNearby,
  };

  // The grid's exact query, so the sidebar's count reads the grid's cache
  // entry and can never describe a different set of products.
  const gridQuery = {
    category: selectedCategories || undefined,
    collection,
    brand: brand || undefined,
    search: searchQuery,
    minPrice,
    maxPrice,
    sortBy,
    page,
    limit: PAGE_SIZE,
    inStock: stockSet.has("in") || undefined,
    outOfStock: stockSet.has("out") || undefined,
    lat: location.lat,
    lng: location.lng,
    radius: location.radius,
    city: location.city,
    pickupNearby: location.pickupNearby,
  };

  // Shared by the desktop toolbar's pill and the phone toolbar's half, so the
  // two cannot end up offering differently worded sort options.
  const sortLabels = {
    label: t("product.sortBy"),
    mostPopular: t("productsPage.filters.sortOptions.mostPopular"),
    bestRating: t("productsPage.filters.sortOptions.bestRating"),
    newest: t("productsPage.filters.sortOptions.newest"),
    priceLowHigh: t("productsPage.filters.sortOptions.priceLowHigh"),
    priceHighLow: t("productsPage.filters.sortOptions.priceHighLow"),
    nearest: t.has("location.nearestFirst")
      ? t("location.nearestFirst")
      : "Nearest",
  };

  return (
    <div className="container mx-auto px-4">
      {/* "Shop **All Products**" — the merchant's own heading wears the same
          two-tone treatment through the shared component; the default comes
          from i18n so locales place the emphasis where their grammar puts
          the product words. */}
      {heading ? (
        <ElectronicsSectionHeading
          as="h1"
          emphasis="tail"
          restStyle="plain"
          title={heading}
          className="mb-8 text-[26px] sm:mb-10 sm:text-[34px]"
        />
      ) : (
        <h1 className="mb-8 text-center text-[26px] font-normal tracking-[-0.03em] text-foreground sm:mb-10 sm:text-[34px]">
          {t.rich("storeProductsPage.title", {
            em: (chunks) => (
              <span className="bg-linear-to-r from-foreground to-foreground/35 bg-clip-text font-bold text-transparent">
                {chunks}
              </span>
            ),
          })}
        </h1>
      )}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[260px_1fr]">
        <StickySidebar className="hidden lg:block">
          {/* The rail paints at once; its result count streams in behind it
              so a total that only annotates the Location group never holds
              back the page. Without the group there is nothing to count. */}
          {showLocation ? (
            <Suspense fallback={<ElectronicsProductsFiltersLazy {...filterProps} />}>
              <WithGridResultCount gridQuery={gridQuery}>
                {(resultCount) => (
                  <ElectronicsProductsFiltersLazy
                    {...filterProps}
                    resultCount={resultCount}
                  />
                )}
              </WithGridResultCount>
            </Suspense>
          ) : (
            <ElectronicsProductsFiltersLazy {...filterProps} />
          )}
          {featured.length > 0 ? (
            <div className="border-t border-border/70">
              <FilterSectionLazy title={t("storeProductsPage.featuredProducts")}>
                <ElectronicsFeaturedProducts
                  locale={locale}
                  products={featured}
                />
              </FilterSectionLazy>
            </div>
          ) : null}
        </StickySidebar>

        {/* `min-w-0` keeps a long product name from widening the grid column
            past its track and pushing the sidebar off. */}
        <div className="min-w-0">
          {/* The phone's sort, sharing the filter trigger's row. Two instances
              of the control rather than one moved around: each breakpoint's
              copy is display-hidden at the other, and both read the same
              `sortBy` out of the URL. */}
          <ElectronicsProductsFiltersMobileLazy
            {...filterProps}
            sort={
              <ProductsSort
                currentSort={sortBy}
                triggerClassName={PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS}
                labels={sortLabels}
              />
            }
          />

          <ElectronicsListingShell
            viewLabel={t("common.view")}
            sort={
              <ProductsSort
                currentSort={sortBy}
                triggerClassName="rounded-lg px-4 data-[size=default]:h-9"
                labels={sortLabels}
              />
            }
          >
            <Suspense fallback={<ProductSkeleton count={PAGE_SIZE} />}>
              {/* Spread from the same object the sidebar counts with, so the
                  two cannot drift into querying different product sets. */}
              <ProductGrid
                locale={locale}
                {...gridQuery}
                appearance="electronics"
                // The design breathes vertically: ~20px between columns,
                // ~40px between rows.
                gridClassName="gap-y-10 lg:grid-cols-[repeat(var(--listing-cols,4),minmax(0,1fr))]"
                paginationParams={{ stock: stockParam || undefined }}
              />
            </Suspense>
          </ElectronicsListingShell>
        </div>
      </div>
    </div>
  );
}

/** The sidebar strip must never take the page down with it. */
async function fetchFeaturedProducts(): Promise<ModernProduct[]> {
  try {
    const result = await getStorefrontProducts<ModernProduct>({
      featured: true,
      limit: FEATURED_LIMIT,
      cardFieldsOnly: true,
    });
    return Array.isArray(result.data) ? result.data : [];
  } catch {
    return [];
  }
}
