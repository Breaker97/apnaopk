import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { resolveListingSort } from "@/lib/products/listing-sort";
import { StickySidebar } from "@/components/ui/sticky-sidebar";
import { WithGridResultCount } from "@/components/products/grid-result-count";
import { ProductGrid } from "@/components/products/product-grid";
import { ProductsSort } from "@/components/products/products-sort";
import { PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS } from "@/components/products/products-mobile-toolbar";
import { ProductSkeleton } from "@/components/products/product-skeleton";
import { SearchOutcome } from "@/components/products/search-outcome";
import { ListingFilterBar } from "@/components/products/listing-filter-bar";
import {
  LISTING_GRID_COLUMNS_CLASS,
  LISTING_PREVIEW_ROW,
  ListingShell,
} from "@/components/products/listing-view";
import { ListingFeaturedProducts } from "@/components/store/sections/listing/featured-products";
import {
  FilterSectionLazy,
  ListingFiltersLazy,
  ListingFiltersMobileLazy,
} from "@/components/store/sections/listing/listing-filters-lazy";
import { ListingCategories } from "@/components/store/sections/listing/listing-categories";
import { ListingHeader } from "@/components/store/sections/listing/listing-header";
import { ProductsBreadcrumb } from "@/components/store/sections/listing/products-breadcrumb";
import { SavedSliderLazy as SavedSlider } from "@/components/store/saved-slider-lazy";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import { getStorefrontOutOfStockDisplay } from "@/lib/catalog/product-visibility";
import { fetchListingFeaturedProducts } from "@/lib/storefront/listing-featured";
import { resolveStockFacet } from "@/lib/catalog/catalog-display";
import {
  optionsFacet,
  priceFacet,
  type ListingFacet,
} from "@/lib/products/listing-facets";
import {
  getStorefrontProductBrands,
  getStorefrontProductFilters,
} from "@/lib/products/storefront-product-filters";
import { buildRenderSlides } from "@/lib/sliders/render";
import {
  listingCategoryTrail,
  resolveListingCategory,
} from "@/lib/storefront/listing-category";
import { resolveCellData } from "@/lib/storefront/sections/section-grid";
import { readSliderCell } from "@/lib/storefront/sections/slider-grids";
import {
  listingBreadcrumbAlignClass,
  listingBreadcrumbInCover,
  listingDesignTitleAlign,
  listingPagination,
  listingShowsFeatured,
  listingTitleAlign,
  type ListingDesign,
  type ProductsListingLayout,
} from "@/lib/storefront/sections/products-listing-layout";
import type { ProductsTemplateResource } from "@/lib/storefront/sections/types";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { cn } from "@/lib/utils";

/** A page of the numbered grid: 8 rows of the 4-column desktop grid. */
const PAGE_SIZE = 32;

/**
 * The products listing core — title, filters, sort toolbar and grid — under
 * every template. The page route keeps the breadcrumb and analytics; this
 * owns everything below.
 *
 * Two DESIGNS draw it (`design`, the section's variant): "classic", the stock
 * page with a left title that scrolls on indefinitely, and "electronics"
 * (Figma 759:179), a centred two-tone title over numbered pages. They share
 * every feature — the full filter set, the cover and its slider, the opened
 * category's name, intro, trail and sub-departments, the featured strip and
 * both pagination modes — and differ only in how the page is drawn and in
 * what "theme" means for the settings that offer it.
 *
 * `layout` is the section's page-design settings. Every default is the page
 * as its design always drew it.
 */
export async function ProductsListing({
  locale,
  heading,
  resource,
  layout,
  design,
  preview = false,
}: {
  locale: Locale;
  /** Custom heading from the section settings; empty falls back to i18n. */
  heading: string;
  resource: ProductsTemplateResource;
  layout: ProductsListingLayout;
  design: ListingDesign;
  /**
   * The builder's framed render of this section alone. Two things differ,
   * both because there is no page around the frame: the breadcrumb the page
   * route normally draws has to come from here, and the grid stops after one
   * row instead of running on for ever.
   */
  preview?: boolean;
}) {
  const t = await getTranslations({ locale });
  const search = resource.searchParams;
  const location = resource.location;
  const electronics = design === "electronics";
  const sidebar = layout.filterLayout === "sidebar";
  const paged = listingPagination(layout.pagination, design) === "pages";
  const showFeatured = sidebar && listingShowsFeatured(layout.featuredProducts, design);

  // Cached getters, resolved together — one round trip, not a waterfall.
  const [
    { categories, collections, priceRange },
    brands,
    featured,
    { headerSettings },
    outOfStockDisplay,
    // Opened on one category, the listing is that category's page: its
    // name for the title, its trail, its sub-departments in the row.
    listingCategory,
  ] = await Promise.all([
    getStorefrontProductFilters(),
    getStorefrontProductBrands(),
    showFeatured ? fetchListingFeaturedProducts() : Promise.resolve([]),
    getStorefrontSettings(),
    getStorefrontOutOfStockDisplay(),
    resolveListingCategory(resource.searchParams),
  ]);

  const { showStockFacet, stockParam, stockSet } = resolveStockFacet(
    search.stock,
    outOfStockDisplay,
  );

  // The store's shopper-location switch: the rail's Location group is the
  // listing's way in, the header's "Deliver to" the other, and both write
  // through the same storage. Collection is a fulfillment choice and no
  // longer implies a payment one, so the facet is offered wherever location is.
  const showLocation = Boolean(headerSettings.widgets?.showLocationPicker);

  const category = typeof search.category === "string" ? search.category : "";
  const collection = typeof search.collection === "string" ? search.collection : "";
  const brand = typeof search.brand === "string" ? search.brand : "";
  const searchQuery =
    typeof search.search === "string" ? search.search : undefined;
  const minPrice =
    typeof search.minPrice === "string" ? search.minPrice : undefined;
  const maxPrice =
    typeof search.maxPrice === "string" ? search.maxPrice : undefined;
  // Best match while searching, most popular while browsing.
  const sortBy = resolveListingSort(search);
  const rawPage = typeof search.page === "string" ? parseInt(search.page, 10) : 1;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  // Shared by the desktop rail, its Suspense fallback and the mobile sheet,
  // so the three cannot drift into offering different filters.
  const filterProps = {
    locale,
    categories,
    categoriesIndexHref: `/${locale}/categories`,
    collections,
    brands,
    priceRange,
    currentCategories: category || undefined,
    currentCollections: collection || undefined,
    currentStock: stockParam || undefined,
    showStockFacet,
    currentBrands: brand || undefined,
    currentMinPrice: minPrice,
    currentMaxPrice: maxPrice,
    showLocation,
    showPickupFacet: showLocation,
    currentPickupNearby: location.pickupNearby,
  };

  // The grid's exact query, so the rail's count reads the grid's cache entry
  // and can never describe a different set of products.
  const gridQuery = {
    category: category || undefined,
    collection: collection || undefined,
    brand: brand || undefined,
    search: searchQuery,
    minPrice,
    maxPrice,
    sortBy,
    page,
    ...(paged ? { limit: PAGE_SIZE } : null),
    inStock: stockSet.has("in") || undefined,
    outOfStock: stockSet.has("out") || undefined,
    lat: location.lat,
    lng: location.lng,
    radius: location.radius,
    city: location.city,
    pickupNearby: location.pickupNearby,
  };

  // Shared by the toolbar's sort and the phone toolbar's half, so the two
  // cannot end up offering differently worded sort options.
  const sortLabels = {
    label: t("product.sortBy"),
    bestMatch: t("productsPage.filters.sortOptions.bestMatch"),
    mostPopular: t("productsPage.filters.sortOptions.mostPopular"),
    bestRating: t("productsPage.filters.sortOptions.bestRating"),
    newest: t("productsPage.filters.sortOptions.newest"),
    priceLowHigh: t("productsPage.filters.sortOptions.priceLowHigh"),
    priceHighLow: t("productsPage.filters.sortOptions.priceHighLow"),
    nearest: t.has("location.nearestFirst")
      ? t("location.nearestFirst")
      : "Nearest",
  };

  const themeAlign = listingDesignTitleAlign(design);
  const align = listingTitleAlign(layout, themeAlign);
  const chips = layout.categoryStyle === "chips";
  // A row of horizontal filters, under the toolbar.
  const filterRow =
    layout.filterLayout === "filterBar" || layout.filterLayout === "filterDropdown"
      ? layout.filterLayout
      : null;

  // The horizontal layouts draw the same facets the rail offers.
  const facets = sidebar
    ? []
    : ([
        showLocation
          ? {
              kind: "location",
              id: "location",
              title: t("location.title"),
              narrowsResults: Boolean(location.pickupNearby),
            }
          : null,
        showLocation
          ? {
              kind: "pickup",
              id: "pickup",
              title: t.has("location.fulfillment")
                ? t("location.fulfillment")
                : "Availability",
              pickupNearby: Boolean(location.pickupNearby),
            }
          : null,
        optionsFacet({
          id: "categories",
          title: t("product.category"),
          param: "category",
          items: categories,
          current: category || undefined,
          viewAllHref: `/${locale}/categories`,
        }),
        optionsFacet({
          id: "collections",
          title: t("nav.collections"),
          param: "collection",
          items: collections,
          current: collection || undefined,
          viewAllHref: `/${locale}/collections`,
        }),
        showStockFacet
          ? {
              kind: "options",
              id: "stock",
              title: t("product.availability"),
              param: "stock",
              options: [
                { value: "in", label: t("common.inStock") },
                { value: "out", label: t("common.outOfStock") },
              ],
              selected: stockParam ? stockParam.split(",") : [],
            }
          : null,
        priceFacet({
          title: t("common.price"),
          priceRange,
          currentMin: minPrice,
          currentMax: maxPrice,
        }),
        optionsFacet({
          id: "brands",
          title: t("storeProductsPage.brands"),
          param: "brand",
          items: brands,
          current: brand || undefined,
          viewAllHref: `/${locale}/brands`,
        }),
      ].filter(Boolean) as ListingFacet[]);

  const categoryRow = (className?: string) => (
    <ListingCategories
      locale={locale}
      layout={layout}
      searchParams={search}
      allLabel={t("nav.allProducts")}
      row={listingCategory?.row}
      className={className}
    />
  );

  const breadcrumbInCover = listingBreadcrumbInCover(layout);
  // Left unless the merchant aligns it, under either design: an untouched
  // Electronics page keeps its left-hung trail over the centred title, the
  // same trail its category pages carry — and the page route, which draws
  // the trail outside a cover, resolves it the same way.
  const crumbAlign = listingBreadcrumbAlignClass(layout, "left");
  const trail = listingCategory
    ? listingCategoryTrail(listingCategory, { searchQuery })
    : [];
  const breadcrumb = (
    <ProductsBreadcrumb
      locale={locale}
      searchQuery={searchQuery}
      trail={trail}
      className={crumbAlign}
    />
  );
  // The category's own words under its name, when it has any and the
  // shopper is browsing it rather than searching within it.
  const categoryIntro =
    listingCategory && !searchQuery ? listingCategory.category.description?.trim() : undefined;
  const pageName = listingCategory?.category.name ?? heading;

  // A saved slider as the banner above the title — the same resolution the
  // slider grid does for a cell, so its products and counts behave alike.
  let banner: React.ReactNode = null;
  if (layout.coverSlider) {
    const cell = readSliderCell({ kind: "slider", slider: layout.coverSlider });
    const { sliders, products } = await resolveCellData([cell]);
    const slider = sliders.get(layout.coverSlider);
    if (slider) {
      banner = (
        <SavedSlider
          slides={buildRenderSlides(slider.slides, products, { locale })}
          className="h-full w-full aspect-auto"
          transition={slider.transition}
          controls={slider.controls}
          handle={slider.handle}
          autoplayDelayMs={slider.autoplaySeconds * 1000}
        />
      );
    }
  }

  const titleAlignClass = align === "center" ? "text-center" : "text-left";
  const title = electronics ? (
    // "Shop **All Products**" — a merchant's heading, or the opened
    // category's name, wears the two-tone treatment through the shared
    // component; the default comes from i18n so locales place the emphasis
    // where their grammar puts the product words.
    pageName ? (
      <ElectronicsSectionHeading
        as="h1"
        emphasis="tail"
        restStyle="plain"
        title={pageName}
        className={cn("text-[26px] sm:text-[34px]", titleAlignClass)}
      />
    ) : (
      <h1
        className={cn(
          "text-[26px] font-normal tracking-[-0.03em] text-foreground sm:text-[34px]",
          titleAlignClass,
        )}
      >
        {t.rich("storeProductsPage.title", {
          em: (chunks) => (
            <span className="bg-linear-to-r from-foreground to-foreground/35 bg-clip-text font-bold text-transparent">
              {chunks}
            </span>
          ),
        })}
      </h1>
    )
  ) : (
    <h1 className="text-[28px]/9 font-bold tracking-tight">
      {pageName || t("nav.allProducts")}
    </h1>
  );

  const featuredStrip =
    featured.length > 0 ? (
      <div className="border-t border-border/70">
        <FilterSectionLazy title={t("storeProductsPage.featuredProducts")}>
          <ListingFeaturedProducts locale={locale} products={featured} />
        </FilterSectionLazy>
      </div>
    ) : null;

  return (
    <div>
      {/* Outside the cover the breadcrumb belongs to the page route, which a
          section preview never runs — so the frame showed a listing with no
          trail at all. Drawing it here for the preview alone keeps the live
          page at exactly one. */}
      {preview && !breadcrumbInCover ? (
        <div className="container mx-auto mb-4 px-4">{breadcrumb}</div>
      ) : null}
      <ListingHeader
        layout={layout}
        align={align}
        className={electronics ? "mb-8 sm:mb-10" : "mb-8"}
        banner={banner}
        title={
          <>
            {title}
            {categoryIntro ? (
              <p
                className={cn(
                  "mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground",
                  align === "center" && "mx-auto",
                )}
              >
                {categoryIntro}
              </p>
            ) : null}
          </>
        }
        breadcrumb={breadcrumbInCover ? breadcrumb : null}
        categories={layout.categoryStyle !== "hidden" && !chips ? categoryRow() : null}
      />

      <div className="container mx-auto px-4">
        {chips ? categoryRow("mb-6") : null}

        <div
          className={cn(
            "grid grid-cols-1 gap-10",
            sidebar && "lg:grid-cols-[260px_1fr]",
          )}
        >
          {sidebar ? (
            <StickySidebar className="hidden lg:block">
              {/* The rail paints at once; its result count streams in behind it
                  so a total that only annotates the Location group never holds
                  back the page. Without the group there is nothing to count. */}
              {showLocation ? (
                <Suspense fallback={<ListingFiltersLazy {...filterProps} />}>
                  <WithGridResultCount gridQuery={gridQuery}>
                    {(resultCount) => (
                      <ListingFiltersLazy {...filterProps} resultCount={resultCount} />
                    )}
                  </WithGridResultCount>
                </Suspense>
              ) : (
                <ListingFiltersLazy {...filterProps} />
              )}
              {featuredStrip}
            </StickySidebar>
          ) : null}

          {/* `min-w-0` keeps a long product name from widening the grid column
              past its track and pushing the sidebar off. */}
          <div className="min-w-0">
            {/* "Showing results for …" after a corrected misspelling. Suspended
                on its own: it reads the grid's cache entry, and must never hold
                back the shell for a one-line note. */}
            <Suspense fallback={null}>
              <SearchOutcome locale={locale} gridQuery={gridQuery} className="mb-4" />
            </Suspense>
            {/* Two instances of the sort control rather than one moved around:
                the phone's rides the filter sheet's toolbar, the desktop's the
                listing toolbar, each display-hidden at the other breakpoint,
                and both read the same `sortBy` out of the URL. */}
            <ListingFiltersMobileLazy
              {...filterProps}
              sort={
                <ProductsSort
                  currentSort={sortBy}
                  triggerClassName={PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS}
                  labels={sortLabels}
                />
              }
            />

            {/* The toolbar: view choices left, sort right. Beside a sidebar the
                sort is a pill (the design's own); over a horizontal filter row
                a labelled select, which reads as part of that row. */}
            <ListingShell
              viewLabel={t("common.view")}
              listLabel={t.has("productsPage.listView") ? t("productsPage.listView") : "List"}
              actions={
                layout.filterLayout === "filterButton" ? (
                  <ListingFilterBar facets={facets} layout="filterButton" />
                ) : null
              }
              sort={
                filterRow ? (
                  <ProductsSort currentSort={sortBy} labels={sortLabels} variant="labeled" />
                ) : electronics ? (
                  <ProductsSort
                    currentSort={sortBy}
                    triggerClassName="rounded-lg px-4 data-[size=default]:h-9"
                    labels={sortLabels}
                  />
                ) : (
                  <ProductsSort currentSort={sortBy} labels={sortLabels} variant="pill" />
                )
              }
              filters={
                filterRow ? (
                  <ListingFilterBar
                    facets={facets}
                    layout={filterRow}
                    className={filterRow === "filterBar" ? "mb-10" : "mb-8"}
                  />
                ) : null
              }
            >
              <Suspense
                fallback={
                  <ProductSkeleton
                    count={preview ? LISTING_PREVIEW_ROW : paged ? PAGE_SIZE : 12}
                  />
                }
              >
                {/* Spread from the same object the rail counts with, so the
                    two cannot drift into querying different product sets. */}
                <ProductGrid
                  locale={locale}
                  {...gridQuery}
                  {...(preview
                    ? { preview: true, limit: LISTING_PREVIEW_ROW }
                    : paged
                      ? null
                      : { infinite: true })}
                  appearance={electronics ? "electronics" : "default"}
                  // The electronics design breathes vertically: ~20px between
                  // columns, ~40px between rows.
                  gridClassName={
                    electronics
                      ? `gap-y-10 ${LISTING_GRID_COLUMNS_CLASS}`
                      : LISTING_GRID_COLUMNS_CLASS
                  }
                  paginationParams={{ stock: stockParam || undefined }}
                />
              </Suspense>
            </ListingShell>
          </div>
        </div>
      </div>
    </div>
  );
}
