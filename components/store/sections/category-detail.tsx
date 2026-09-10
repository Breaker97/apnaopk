import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ImageOff, PackageSearch } from "lucide-react";
import { type Locale } from "@/config/i18n.config";
import {
  locationFromRequestSearch,
  normalizeRequestSortBy,
} from "@/lib/locations/shopper-location";
import { AppImage } from "@/components/ui/app-image";
import { LocationPickerLazy } from "@/components/layout/location-picker-lazy";
import {
  ProductGrid,
  ProductSkeleton,
} from "@/components/products/product-grid";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import type { CategoryTemplateResource } from "@/lib/storefront/sections/types";

/**
 * The category template's two halves, split so merchandisers can replace
 * the stock header with their own hero while the grid core stays locked.
 * Both moved verbatim from the hand-wired /categories/[slug] page.
 */

export async function CategoryDetailHeader({
  locale,
  resource,
}: {
  locale: Locale;
  resource: CategoryTemplateResource;
}) {
  const t = await getTranslations({ locale });
  const category = resource.category;
  const image = (category.image || category.icon) as string | undefined;

  return (
    <section className="container mx-auto mb-8 px-4">
      <div className="grid gap-6 rounded-md border bg-background p-5 sm:grid-cols-[180px_1fr] sm:p-6">
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

        <div className="flex min-w-0 flex-col justify-center">
          <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
          {typeof category.description === "string" && category.description ? (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
              {category.description}
            </p>
          ) : null}
          <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <PackageSearch className="h-4 w-4" />
            {t("storeCategoryDetailPage.productsCount", {
              count: Number(category.productCount ?? 0),
            })}
          </p>
        </div>
      </div>
    </section>
  );
}

export async function CategoryDetailMain({
  locale,
  resource,
}: {
  locale: Locale;
  resource: CategoryTemplateResource;
}) {
  const t = await getTranslations({ locale });
  const search = resource.searchParams;
  const location = resource.location;

  const page = typeof search.page === "string" ? parseInt(search.page, 10) : 1;
  const sortBy =
    normalizeRequestSortBy(
      typeof search.sortBy === "string" ? search.sortBy : undefined,
      search,
    ) || "popular";

  // The classic category page has no filter rail to host a Location group, so
  // it keeps a picker of its own right above the grid it narrows. Seeded from
  // the URL, which is what that grid is filtered by — the header's "Deliver to"
  // is a delivery address and says nothing about this listing.
  const { headerSettings } = await getStorefrontSettings();
  const showLocation = Boolean(headerSettings.widgets?.showLocationPicker);
  const initialLocation = showLocation
    ? locationFromRequestSearch(search)
    : null;

  return (
    <div className="container mx-auto px-4">
      {showLocation ? (
        <div className="-ms-2.5 mb-4">
          <LocationPickerLazy initialLocation={initialLocation} />
        </div>
      ) : null}

      <Suspense fallback={<ProductSkeleton count={12} />}>
        <ProductGrid
          locale={locale}
          category={resource.category.slug}
          sortBy={sortBy}
          page={Number.isNaN(page) ? 1 : page}
          emptyMessage={t("storeCategoryDetailPage.empty")}
          lat={location.lat}
          lng={location.lng}
          radius={location.radius}
          city={location.city}
          pickupNearby={location.pickupNearby}
        />
      </Suspense>
    </div>
  );
}
