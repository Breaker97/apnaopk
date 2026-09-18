import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ImageOff, PackageSearch } from "lucide-react";
import { type Locale } from "@/config/i18n.config";
import {
  locationFromRequestSearch,
  normalizeRequestSortBy,
} from "@/lib/locations/shopper-location";
import { AppImage } from "@/components/ui/app-image";
import { StickySidebar } from "@/components/ui/sticky-sidebar";
import { LocationPickerLazy } from "@/components/layout/location-picker-lazy";
import { WithGridResultCount } from "@/components/products/grid-result-count";
import { ProductGrid } from "@/components/products/product-grid";
import { ProductSkeleton } from "@/components/products/product-skeleton";
import { ProductsSort } from "@/components/products/products-sort";
import { PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS } from "@/components/products/products-mobile-toolbar";
import {
  LISTING_GRID_COLUMNS_CLASS,
  ListingShell,
} from "@/components/products/listing-view";
import { ListingFeaturedProducts } from "@/components/store/sections/listing/featured-products";
import {
  FilterSectionLazy,
  ListingFiltersLazy,
  ListingFiltersMobileLazy,
} from "@/components/store/sections/listing/listing-filters-lazy";
import { SubcategoryScroller } from "@/components/store/sections/listing/subcategory-scroller";
import { getStorefrontOutOfStockDisplay } from "@/lib/catalog/product-visibility";
import { resolveStockFacet } from "@/lib/catalog/catalog-display";
import { getStorefrontCategoryFacets } from "@/lib/products/storefront-product-filters";
import type {
  CategoryHeaderLayout,
  CategoryMainLayout,
} from "@/lib/storefront/sections/category-page-layout";
import type { ListingDesign } from "@/lib/storefront/sections/products-listing-layout";
import type { CategoryTemplateResource } from "@/lib/storefront/sections/types";
import { fetchListingFeaturedProducts } from "@/lib/storefront/listing-featured";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { cn } from "@/lib/utils";

/**
 * The category template's two halves, split so merchandisers can replace
 * the stock header with their own hero while the grid core stays locked.
 *
 * Each half has two DESIGNS (the sections' variants): "classic" and
 * "electronics". Both draw every piece of the page — picture, description,
 * product count and department row in the header; filter sidebar, sort,
 * featured strip and either pagination in the grid — and the section's
 * settings turn each piece on or off (`category-page-layout.ts`). A design
 * only decides how the page is drawn and what "theme" means for a setting.
 */

type CategoryChild = {
  _id: string;
  slug: string;
  name: string;
  image?: string;
  icon?: string;
};

function categoryChildren(
  category: CategoryTemplateResource["category"],
): CategoryChild[] {
  return Array.isArray(category.children)
    ? (category.children as CategoryChild[])
    : [];
}

export async function CategoryDetailHeader({
  locale,
  resource,
  design,
  layout,
}: {
  locale: Locale;
  resource: CategoryTemplateResource;
  design: ListingDesign;
  layout: CategoryHeaderLayout;
}) {
  const t = await getTranslations({ locale });
  const category = resource.category;
  const image = (category.image || category.icon) as string | undefined;
  const description =
    layout.description && typeof category.description === "string"
      ? category.description.trim()
      : "";
  const children = layout.subcategories ? categoryChildren(category) : [];

  const count = layout.productCount ? (
    <p
      className={cn(
        "inline-flex items-center gap-2 text-sm text-muted-foreground",
        design === "electronics" ? "mt-3" : "mt-4",
      )}
    >
      <PackageSearch className="h-4 w-4" />
      {t("storeCategoryDetailPage.productsCount", {
        count: Number(category.productCount ?? 0),
      })}
    </p>
  ) : null;

  const departments =
    children.length > 0 ? (
      <div className={design === "electronics" ? "mt-8 sm:mt-10" : "mt-6"}>
        <SubcategoryScroller
          locale={locale}
          categories={children.map((child) => ({
            id: child._id,
            slug: child.slug,
            name: child.name,
            image: child.image || child.icon,
          }))}
        />
      </div>
    ) : null;

  if (design === "electronics") {
    return (
      <section className="container mx-auto mb-8 px-4 sm:mb-10">
        <div className="flex flex-col items-center text-center">
          {layout.image && image ? (
            <span className="relative mb-5 grid size-24 place-items-center overflow-hidden rounded-xl bg-muted">
              <AppImage
                src={image}
                alt={category.name}
                fill
                sizes="96px"
                className="object-contain p-3"
              />
            </span>
          ) : null}
          {/* "Shop by **Laptops**" — the message decides where the category
              name sits, so locales that lead with the noun stay grammatical
              while the gradient always lands on the name itself. */}
          <h1 className="text-[26px] font-normal tracking-[-0.03em] text-foreground sm:text-[34px]">
            {t.rich("storeCategoryDetailPage.title", {
              name: category.name,
              em: (chunks) => (
                <span className="bg-linear-to-r from-foreground to-foreground/35 bg-clip-text font-bold text-transparent">
                  {chunks}
                </span>
              ),
            })}
          </h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              {description}
            </p>
          ) : null}
          {count}
        </div>
        {departments}
      </section>
    );
  }

  return (
    <section className="container mx-auto mb-8 px-4">
      <div
        className={cn(
          "grid gap-6 rounded-md border bg-background p-5 sm:p-6",
          layout.image && "sm:grid-cols-[180px_1fr]",
        )}
      >
        {layout.image ? (
          <div className="relative aspect-square overflow-hidden rounded-md bg-muted/50">
            {image ? (
              <AppImage
                src={image}
                alt={category.name}
                fill
                sizes="180px"
                className="object-contain p-6"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-muted-foreground/55">
                <ImageOff className="h-8 w-8" />
              </div>
            )}
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col justify-center">
          <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
          {description ? (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
              {description}
            </p>
          ) : null}
          {count}
        </div>
      </div>
      {departments}
    </section>
  );
}

export async function CategoryDetailMain({
  locale,
  resource,
  design,
  layout,
}: {
  locale: Locale;
  resource: CategoryTemplateResource;
  design: ListingDesign;
  layout: CategoryMainLayout;
}) {
  const t = await getTranslations({ locale });
  const category = resource.category;
  const search = resource.searchParams;
  const location = resource.location;
  const electronics = design === "electronics";

  const subcategories = categoryChildren(category).map((child) => ({
    name: child.name,
    slug: child.slug,
  }));
  const subcategorySlugs = new Set(subcategories.map((entry) => entry.slug));

  // Only this category's own children count as a selection — any other slug
  // in the param would quietly turn this page into a different listing. The
  // selection is a filter, so it only applies while the filters are shown.
  const selectedCategories =
    layout.filters && typeof search.category === "string"
      ? search.category
          .split(",")
          .filter((slug) => subcategorySlugs.has(slug))
          .join(",")
      : "";
  const brand =
    layout.filters && typeof search.brand === "string" ? search.brand : "";
  const minPrice =
    layout.filters && typeof search.minPrice === "string" ? search.minPrice : undefined;
  const maxPrice =
    layout.filters && typeof search.maxPrice === "string" ? search.maxPrice : undefined;
  const sortBy =
    normalizeRequestSortBy(
      typeof search.sortBy === "string" ? search.sortBy : undefined,
      search,
    ) || "popular";
  const rawPage = typeof search.page === "string" ? parseInt(search.page, 10) : 1;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  // No sub-category selection means the whole branch, exactly as before.
  const categoryFilter = selectedCategories || category.slug;

  const [{ priceRange, brands }, featured, { headerSettings }, outOfStockDisplay] =
    await Promise.all([
      getStorefrontCategoryFacets(category.slug),
      layout.featured
        ? fetchListingFeaturedProducts(category.slug)
        : Promise.resolve([]),
      getStorefrontSettings(),
      getStorefrontOutOfStockDisplay(),
    ]);

  const { showStockFacet, stockParam, stockSet } = resolveStockFacet(
    layout.filters ? search.stock : undefined,
    outOfStockDisplay,
  );

  // Same rule as the products listing: the rail's Location group is this
  // page's way in, the header's "Deliver to" the other, and both write
  // through the same storage. Without a rail, a picker of its own sits right
  // above the grid it narrows, seeded from the URL the grid is filtered by.
  const showLocation = Boolean(headerSettings.widgets?.showLocationPicker);

  const filterProps = {
    locale,
    categories: subcategories,
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

  // The grid's exact query, so the rail's count reads the grid's cache entry
  // and can never describe a different set of products.
  const gridQuery = {
    category: categoryFilter,
    brand: brand || undefined,
    minPrice,
    maxPrice,
    sortBy,
    page,
    inStock: stockSet.has("in") || undefined,
    outOfStock: stockSet.has("out") || undefined,
    lat: location.lat,
    lng: location.lng,
    radius: location.radius,
    city: location.city,
    pickupNearby: location.pickupNearby,
  };

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

  // The toolbar (view choices + sort) frames the grid whenever the page has
  // one of the two: a sort to host, or a filter rail beside it.
  const toolbar = layout.sort || layout.filters;

  const grid = (
    <Suspense fallback={<ProductSkeleton count={12} />}>
      {/* Spread from the same object the rail counts with, so the two cannot
          drift into querying different product sets. */}
      <ProductGrid
        locale={locale}
        {...gridQuery}
        {...(layout.pagination === "infinite" ? { infinite: true } : null)}
        appearance={electronics ? "electronics" : "default"}
        gridClassName={
          toolbar
            ? cn(electronics && "gap-y-10", LISTING_GRID_COLUMNS_CLASS)
            : undefined
        }
        paginationParams={{ stock: stockParam || undefined }}
        emptyMessage={t("storeCategoryDetailPage.empty")}
      />
    </Suspense>
  );

  const body = toolbar ? (
    <ListingShell
      viewLabel={t("common.view")}
      listLabel={t.has("productsPage.listView") ? t("productsPage.listView") : "List"}
      sort={
        layout.sort ? (
          electronics ? (
            <ProductsSort
              currentSort={sortBy}
              triggerClassName="rounded-lg px-4 data-[size=default]:h-9"
              labels={sortLabels}
            />
          ) : (
            <ProductsSort currentSort={sortBy} labels={sortLabels} variant="pill" />
          )
        ) : null
      }
    >
      {grid}
    </ListingShell>
  ) : (
    grid
  );

  const mobileSort = layout.sort ? (
    <ProductsSort
      currentSort={sortBy}
      triggerClassName={PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS}
      labels={sortLabels}
    />
  ) : undefined;

  if (!layout.filters) {
    return (
      <div className="container mx-auto px-4">
        {showLocation ? (
          <div className="-ms-2.5 mb-4">
            <LocationPickerLazy initialLocation={locationFromRequestSearch(search)} />
          </div>
        ) : null}
        {mobileSort ? <div className="mb-4 flex justify-end lg:hidden">{mobileSort}</div> : null}
        {body}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[260px_1fr]">
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
          {featured.length > 0 ? (
            <div className="border-t border-border/70">
              <FilterSectionLazy title={t("storeCategoryDetailPage.featuredProducts")}>
                <ListingFeaturedProducts locale={locale} products={featured} />
              </FilterSectionLazy>
            </div>
          ) : null}
        </StickySidebar>

        {/* `min-w-0` keeps a long product name from widening the grid column
            past its track and pushing the sidebar off. */}
        <div className="min-w-0">
          <ListingFiltersMobileLazy {...filterProps} sort={mobileSort} />
          {body}
        </div>
      </div>
    </div>
  );
}
