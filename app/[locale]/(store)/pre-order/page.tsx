import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarClock,
  CreditCard,
  PackageCheck,
  Sparkles,
} from "lucide-react";
import { type Locale } from "@/config/i18n.config";
import { resolveRequestLocation } from "@/lib/locations/resolve-request-location";
import { locationFromRequestSearch } from "@/lib/locations/shopper-location";
import { Separator } from "@/components/ui/separator";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { LocationPickerLazy } from "@/components/layout/location-picker-lazy";
import { ProductGrid } from "@/components/products/product-grid";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProductSkeleton } from "@/components/products/product-skeleton";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

const PREORDER_PAGE_TEXT = {
  metaTitle: "Pre-order",
  metaDescription: "Browse products currently available to reserve before they ship.",
  title: "Pre-order Drops",
  subtitle:
    "Reserve upcoming products early, see the expected ship window, and track every pre-order from your account.",
  empty: "No products are available for pre-order right now.",
};

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  const tr = (key: keyof typeof PREORDER_PAGE_TEXT) => {
    const messageKey = `preorderPage.${key}`;
    return t.has(messageKey) ? t(messageKey) : PREORDER_PAGE_TEXT[key];
  };

  return {
    title: tr("metaTitle"),
    description: tr("metaDescription"),
  };
}

export default async function PreOrderPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  // Both cached getters, so the settings read costs no extra round trip.
  const [t, { headerSettings, storeName }] = await Promise.all([
    getTranslations({ locale }),
    getStorefrontSettings(),
  ]);
  const tr = (key: keyof typeof PREORDER_PAGE_TEXT) => {
    const messageKey = `preorderPage.${key}`;
    return t.has(messageKey) ? t(messageKey) : PREORDER_PAGE_TEXT[key];
  };
  const page = typeof search.page === "string" ? parseInt(search.page) : 1;
  const sort = typeof search.sort === "string" ? search.sort : "release";
  // The page's own location pill applies here — a pre-order list filtered to
  // nowhere would contradict the location the control claims to be showing.
  const location = resolveRequestLocation(search);
  const showLocation = Boolean(headerSettings.widgets?.showLocationPicker);
  // The pill filters this list, so it is seeded from the params the list is
  // filtered by rather than from the shopper's saved delivery place.
  const initialLocation = showLocation
    ? locationFromRequestSearch(search)
    : null;
  const sortConfig =
    sort === "reserved"
      ? { sortBy: "preorder-reserved", sortOrder: "desc" }
      : sort === "newest"
        ? { sortBy: "createdAt", sortOrder: "desc" }
        : { sortBy: "preorder-release", sortOrder: "asc" };
  const sortOptions = [
    { id: "release", label: "Ships soonest" },
    { id: "reserved", label: "Most reserved" },
    { id: "newest", label: "Newest drops" },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      <StoreBreadcrumb
        className="mb-4"
        locale={locale}
        items={[{ label: tr("metaTitle") }]}
      />

      <section className="mb-7 overflow-hidden rounded-lg border border-primary/15 bg-card shadow-sm">
        <div className="grid gap-7 px-5 py-7 md:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.8fr)] md:px-8 lg:px-10">
          <div className="min-w-0">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {storeName} early access
            </div>
            <h1 className="text-3xl font-bold tracking-normal text-foreground md:text-4xl">
              {tr("title")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              {tr("subtitle")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium">
              <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-700 ring-1 ring-blue-100">
                Release windows visible
              </span>
              <span className="rounded-full bg-violet-50 px-3 py-1.5 text-violet-700 ring-1 ring-violet-100">
                Deposit-aware checkout
              </span>
              <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700 ring-1 ring-amber-100">
                Account tracking
              </span>
            </div>
          </div>

          <div className="grid content-center gap-3">
            {[
              {
                icon: CalendarClock,
                label: "Transparent ship dates",
                value: "Included",
                color: "text-blue-600 bg-blue-50 ring-blue-100",
              },
              {
                icon: CreditCard,
                label: "Deposit and pay-later terms",
                value: "Shown upfront",
                color: "text-violet-600 bg-violet-50 ring-violet-100",
              },
              {
                icon: PackageCheck,
                label: "Account tracking",
                value: "After checkout",
                color: "text-amber-600 bg-amber-50 ring-amber-100",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 rounded-lg border bg-background px-3 py-3"
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ring-1 ${item.color}`}
                >
                  <item.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* No filter rail to host a Location group here, so the listing keeps
          a picker of its own right above the grid it narrows; the header's
          "Deliver to" writes through the same storage. */}
      {showLocation ? (
        <div className="-ms-2.5 mb-4">
          <LocationPickerLazy initialLocation={initialLocation} />
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {sortOptions.map((option) => (
            <Link
              key={option.id}
              href={`?sort=${option.id}`}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                sort === option.id
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-foreground hover:border-primary/35 hover:text-primary"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
        <Link
          href={`/${locale}/account/orders/pre-orders`}
          className="inline-flex items-center rounded-full border border-primary/15 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          Track my pre-orders
        </Link>
      </div>

      <Separator className="mb-8" />

      <Suspense fallback={<ProductSkeleton count={9} />}>
        <ProductGrid
          locale={locale as Locale}
          preorder
          sortBy={sortConfig.sortBy}
          sortOrder={sortConfig.sortOrder}
          page={page}
          emptyMessage={tr("empty")}
          lat={location.lat}
          lng={location.lng}
          radius={location.radius}
          city={location.city}
          pickupNearby={location.pickupNearby}
          paginationParams={{ sort }}
        />
      </Suspense>
    </div>
  );
}
