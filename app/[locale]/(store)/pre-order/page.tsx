import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CreditCard, PackageCheck } from "lucide-react";
import { type Locale } from "@/config/i18n.config";
import { resolveRequestLocation } from "@/lib/locations/resolve-request-location";
import { locationFromRequestSearch } from "@/lib/locations/shopper-location";
import { Button } from "@/components/ui/button";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { LocationPickerLazy } from "@/components/layout/location-picker-lazy";
import { ProductGrid } from "@/components/products/product-grid";
import { countGridResults } from "@/components/products/grid-result-count";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProductSkeleton } from "@/components/products/product-skeleton";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const SORTS = {
  release: { sortBy: "preorder-release", sortOrder: "asc" },
  reserved: { sortBy: "preorder-reserved", sortOrder: "desc" },
  newest: { sortBy: "createdAt", sortOrder: "desc" },
} as const;

type SortId = keyof typeof SORTS;

/**
 * Five across on a wide screen. This page has no filter rail, so four
 * columns over the full container drew each card about a third wider than
 * the same card on /products, which shares its row with a 260px sidebar.
 */
const GRID_COLUMNS = "lg:grid-cols-5";
/** Three full rows of five. */
const PAGE_SIZE = 15;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });

  return {
    title: t("preorderPage.metaTitle"),
    description: t("preorderPage.metaDescription"),
  };
}

export default async function PreOrderPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const page = typeof search.page === "string" ? parseInt(search.page) : 1;
  const sort: SortId =
    typeof search.sort === "string" && search.sort in SORTS
      ? (search.sort as SortId)
      : "release";
  // The page's own location pill applies here — a pre-order list filtered to
  // nowhere would contradict the location the control claims to be showing.
  const location = resolveRequestLocation(search);
  const gridQuery = {
    preorder: true,
    ...SORTS[sort],
    page,
    limit: PAGE_SIZE,
    lat: location.lat,
    lng: location.lng,
    radius: location.radius,
    city: location.city,
    pickupNearby: location.pickupNearby,
  };

  // Both cached getters, and the count is the grid's own query, so it reads
  // the grid's cache entry rather than running a second count.
  const [t, { headerSettings }, total] = await Promise.all([
    getTranslations({ locale }),
    getStorefrontSettings(),
    countGridResults(gridQuery),
  ]);
  const showLocation = Boolean(headerSettings.widgets?.showLocationPicker);
  // The pill filters this list, so it is seeded from the params the list is
  // filtered by rather than from the shopper's saved delivery place.
  const initialLocation = showLocation
    ? locationFromRequestSearch(search)
    : null;
  // Only "pickup near me" narrows the grid; a location otherwise just labels
  // and orders it. So zero without that facet means the shelf itself is
  // empty, and the toolbar has nothing to sort. Zero WITH it falls through to
  // the grid, which offers to clear the location.
  const shelfEmpty = total === 0 && !location.pickupNearby;

  // Sorting keeps the shopper's location; only the page resets.
  const sortHref = (id: SortId) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (key === "sort" || key === "page" || typeof value !== "string") {
        continue;
      }
      query.set(key, value);
    }
    query.set("sort", id);
    return `?${query.toString()}`;
  };

  const facts = [
    { icon: CalendarClock, label: t("preorderPage.facts.shipDate") },
    { icon: CreditCard, label: t("preorderPage.facts.payment") },
    { icon: PackageCheck, label: t("preorderPage.facts.tracking") },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      <StoreBreadcrumb
        className="mb-4"
        locale={locale}
        items={[{ label: t("preorderPage.metaTitle") }]}
      />

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            {t("preorderPage.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
            {t("preorderPage.subtitle")}
          </p>
          <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
            {facts.map((fact) => (
              <li key={fact.label} className="inline-flex items-center gap-1.5">
                <fact.icon
                  className="h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                {fact.label}
              </li>
            ))}
          </ul>
        </div>
        <Link
          href={`/${locale}/account/orders/pre-orders`}
          data-slot="button"
          className="inline-flex items-center whitespace-nowrap border border-primary/15 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          {t("preorderPage.trackOrders")}
        </Link>
      </div>

      {shelfEmpty ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-lg border border-dashed px-5 py-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
            <CalendarClock className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            {t("preorderPage.emptyTitle")}
          </h2>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            {t("preorderPage.emptyDescription")}
          </p>
          <Button asChild className="mt-2">
            <Link href={`/${locale}/products`}>
              {t("preorderPage.browseAll")}
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3 border-y py-3">
            {/* No filter rail to host a Location group here, so the listing
                keeps a picker of its own in the toolbar above the grid it
                narrows; the header's "Deliver to" writes through the same
                storage. */}
            {showLocation ? (
              <div className="-ms-2.5">
                <LocationPickerLazy initialLocation={initialLocation} />
              </div>
            ) : null}
            <nav
              aria-label={t("preorderPage.sortLabel")}
              className="order-last flex w-full gap-2 overflow-x-auto [scrollbar-width:none] md:order-none md:w-auto"
            >
              {(Object.keys(SORTS) as SortId[]).map((id) => (
                <Link
                  key={id}
                  href={sortHref(id)}
                  aria-current={sort === id ? "page" : undefined}
                  className={`shrink-0 whitespace-nowrap rounded-button border px-4 py-2 text-sm font-semibold transition-colors ${
                    sort === id
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-background text-foreground hover:border-primary/35 hover:text-primary"
                  }`}
                >
                  {t(`preorderPage.sort.${id}`)}
                </Link>
              ))}
            </nav>
            {typeof total === "number" ? (
              <p className="ms-auto text-sm text-muted-foreground">
                {t("preorderPage.count", { count: total })}
              </p>
            ) : null}
          </div>

          <div className="mt-6">
            <Suspense
              fallback={<ProductSkeleton count={PAGE_SIZE} className={GRID_COLUMNS} />}
            >
              <ProductGrid
                locale={locale as Locale}
                {...gridQuery}
                emptyMessage={t("preorderPage.empty")}
                paginationParams={{ sort }}
                gridClassName={GRID_COLUMNS}
              />
            </Suspense>
          </div>
        </>
      )}
    </div>
  );
}
