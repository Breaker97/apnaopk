import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { normalizeRequestSortBy } from "@/lib/locations/shopper-location";
import { Separator } from "@/components/ui/separator";
import { StickySidebar } from "@/components/ui/sticky-sidebar";
import { ProductGrid } from "@/components/products/product-grid";
import { ProductFiltersLazy } from "@/components/products/product-filters-lazy";
import { ProductsSort } from "@/components/products/products-sort";
import { PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS } from "@/components/products/products-mobile-toolbar";
import { ProductFiltersWithCount } from "@/components/products/product-filters-with-count";
import { ProductFiltersMobileLazy } from "@/components/products/product-filters-mobile-lazy";
import { ProductSkeleton } from "@/components/products/product-skeleton";
import { getStorefrontProductFilters } from "@/lib/products/storefront-product-filters";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import type { ProductsTemplateResource } from "@/lib/storefront/sections/types";

/**
 * The products listing core — the hand-wired /products page body (title +
 * sort toolbar, faceted sidebar, infinite grid), moved verbatim so the
 * default products template renders identically. The page keeps the
 * breadcrumb and analytics; this owns everything below.
 */
export async function ProductsListing({
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
  const { lat, lng, radius, city, pickupNearby } = resource.location;

  // Both are cached getters, so this is one round trip rather than a
  // waterfall. The header widget flag survives as the master switch for
  // shopper location UI.
  const [{ categories, collections }, { headerSettings }] = await Promise.all([
    getStorefrontProductFilters(),
    getStorefrontSettings(),
  ]);
  const showLocation = Boolean(headerSettings.widgets?.showLocationPicker);
  // Collection is a fulfillment choice and no longer implies a payment one,
  // so the facet is offered wherever the location picker is.
  const showPickupFacet = showLocation;

  const category =
    typeof search.category === "string" ? search.category : undefined;
  const brand = typeof search.brand === "string" ? search.brand : undefined;
  const collection =
    typeof search.collection === "string" ? search.collection : undefined;
  const searchQuery =
    typeof search.search === "string" ? search.search : undefined;
  const minPrice =
    typeof search.minPrice === "string" ? search.minPrice : undefined;
  const maxPrice =
    typeof search.maxPrice === "string" ? search.maxPrice : undefined;
  const sortBy =
    normalizeRequestSortBy(
      typeof search.sortBy === "string" ? search.sortBy : undefined,
      search,
    ) || "popular";
  const page = typeof search.page === "string" ? parseInt(search.page) : 1;

  // Shared by the desktop panel, its Suspense fallback and the mobile sheet,
  // so the three cannot drift into offering different filters.
  const filterProps = {
    locale,
    categories,
    collections,
    currentCategory: category,
    currentCollection: collection,
    currentMinPrice: minPrice,
    currentMaxPrice: maxPrice,
    currentSort: sortBy,
    showLocation,
    showPickupFacet,
    currentPickupNearby: pickupNearby,
    // Sorting lives in the header toolbar beside the title.
    showSort: false,
  };

  const gridQuery = {
    category,
    collection,
    brand,
    search: searchQuery,
    minPrice,
    maxPrice,
    sortBy,
    page,
    lat,
    lng,
    radius,
    city,
    pickupNearby,
  };

  // Shared by the header pill and the phone toolbar's half, so the two cannot
  // end up offering differently worded sort options.
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
      {/* Page Header. Sort rides here rather than in the sidebar: it is not
          a filter, and at the foot of a long facet column shoppers never
          find it. Below lg it moves again, into the mobile filter toolbar:
          beside the heading it left the full-width "Filters" button stacked
          under it, two rows of chrome above the first product. */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-[28px]/9 font-bold tracking-tight">
          {heading || t("nav.allProducts")}
        </h1>

        <div className="hidden lg:block">
          <ProductsSort currentSort={sortBy} labels={sortLabels} />
        </div>
      </div>

      <Separator className="mb-8" />

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[260px_1fr]">
        {/* Filters Sidebar (desktop). Suspended on its own so resolving the
            result count never delays the shell; sticky because the grid
            beside it runs on indefinitely. */}
        <StickySidebar className="hidden lg:block">
          <Suspense fallback={<ProductFiltersLazy {...filterProps} />}>
            <ProductFiltersWithCount {...filterProps} gridQuery={gridQuery} />
          </Suspense>
        </StickySidebar>

        {/* `min-w-0` keeps a long product name from widening the grid column
            past its track and pushing the sidebar off. */}
        <div className="min-w-0">
          {/* Two instances of the sort control rather than one moved around:
              each breakpoint's copy is display-hidden at the other, and both
              read the same `sortBy` out of the URL. */}
          <ProductFiltersMobileLazy
            {...filterProps}
            sort={
              <ProductsSort
                currentSort={sortBy}
                triggerClassName={PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS}
                labels={sortLabels}
              />
            }
          />

          <Suspense fallback={<ProductSkeleton count={12} />}>
            {/* Spread from the same object the sidebar counts with, so the
                two cannot drift into querying different product sets. */}
            <ProductGrid locale={locale} {...gridQuery} infinite />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
