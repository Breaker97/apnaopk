import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { ExternalLink, Globe, ImageOff, PackageSearch } from "lucide-react";
import { type Locale } from "@/config/i18n.config";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ModernProductCardSkeleton,
  type ModernProduct,
} from "@/components/products/modern-product-card";
import { CollectionProductsGrid } from "@/components/products/collection-products-grid";
import { getStorefrontBrandDetail } from "@/lib/brands/storefront-brands";
import {
  resolveRequestLocation,
  type RequestLocation,
} from "@/lib/locations/resolve-request-location";

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface BrandData {
  brand: {
    _id: string;
    name: string;
    slug: string;
    description?: string;
    logo?: string;
    website?: string;
    seo?: { pageTitle?: string; metaDescription?: string };
    productCount: number;
  };
  products: ModernProduct[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// The shopper's location is deliberately not passed: it is a lens on the
// storefront, not a filter, so it does not change which products carry a brand.
// It still travels in the page links below, because the header pill and every
// other page do read it.
async function getBrandData(
  slug: string,
  page: number = 1,
  sort?: string,
): Promise<BrandData | null> {
  return getStorefrontBrandDetail({
    slug,
    page,
    limit: 24,
    sort,
  }) as Promise<BrandData | null>;
}

function normalizeWebsite(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function websiteLabel(url: string) {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getBrandData(slug);
  if (!data) return {};

  const { brand } = data;
  const title = brand.seo?.pageTitle || brand.name;
  const description =
    brand.seo?.metaDescription ||
    brand.description ||
    `Shop ${brand.name} products.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: brand.logo ? [{ url: brand.logo }] : undefined,
    },
  };
}

export default async function BrandDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { locale, slug } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });

  const page = typeof search.page === "string" ? parseInt(search.page) : 1;
  const sort = typeof search.sort === "string" ? search.sort : undefined;
  const location = resolveRequestLocation(search);

  const data = await getBrandData(slug, page, sort);
  if (!data) notFound();

  const { brand, products, pagination } = data;

  return (
    <div className="container mx-auto px-4 py-8">
      <StoreBreadcrumb
        locale={locale}
        items={[
          { label: t("nav.brands"), href: "/brands" },
          { label: brand.name },
        ]}
      />

      {/* Brand hero */}
      <section className="relative mb-8 overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-muted/40 to-background">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-col items-center gap-6 p-6 text-center sm:p-10 md:flex-row md:items-center md:gap-8 md:text-left">
          <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-background shadow-sm sm:h-32 sm:w-32">
            {brand.logo ? (
              <AppImage
                src={brand.logo}
                alt={brand.name}
                width={128}
                height={128}
                className="h-full w-full object-contain p-3"
              />
            ) : (
              <ImageOff className="h-9 w-9 text-muted-foreground/50" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                {t("nav.brands")}
              </p>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {brand.name}
              </h1>
            </div>

            {brand.description ? (
              <p className="mx-auto max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base md:mx-0">
                {brand.description}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1 md:justify-start">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                <PackageSearch className="h-3.5 w-3.5" />
                {t("storeBrandDetailPage.productsCount", {
                  count: pagination.total,
                })}
              </span>

              {brand.website ? (
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-full"
                >
                  <a
                    href={normalizeWebsite(brand.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {websiteLabel(brand.website)}
                    <ExternalLink className="h-3 w-3 opacity-70" />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("storeBrandDetailPage.productsCount", {
            count: pagination.total,
          })}
        </p>

        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {t("storeBrandDetailPage.sortByLabel")}
          </span>
          <SortSelect
            currentSort={sort}
            slug={slug}
            locale={locale}
            location={location}
            labels={{
              placeholder: t("storeBrandDetailPage.sortPlaceholder"),
              featured: t("storeBrandDetailPage.sortOptions.featured"),
              bestSelling: t("storeBrandDetailPage.sortOptions.bestSelling"),
              aToZ: t("storeBrandDetailPage.sortOptions.aToZ"),
              zToA: t("storeBrandDetailPage.sortOptions.zToA"),
              priceLowHigh: t("storeBrandDetailPage.sortOptions.priceLowHigh"),
              priceHighLow: t("storeBrandDetailPage.sortOptions.priceHighLow"),
              newest: t("storeBrandDetailPage.sortOptions.newest"),
            }}
          />
        </div>
      </div>

      {/* Products */}
      <Suspense fallback={<ProductsGridSkeleton />}>
        {products.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border bg-background py-12 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-muted">
              <PackageSearch className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">
              {t("storeBrandDetailPage.emptyProductsTitle")}
            </h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {t("storeBrandDetailPage.emptyProductsDescription")}
            </p>
          </div>
        ) : (
          <CollectionProductsGrid products={products} locale={locale as Locale} />
        )}
      </Suspense>

      {/* Pagination */}
      {pagination.totalPages > 1 ? (
        <div className="mt-10 flex items-center justify-center gap-2">
          {pagination.hasPrev ? (
            <Link
              href={buildPageUrl(page - 1, sort, location)}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
            >
              {t("storeBrandDetailPage.pagination.previous")}
            </Link>
          ) : null}

          <span className="px-4 py-2 text-sm text-muted-foreground">
            {t("storeBrandDetailPage.pagination.pageOf", {
              current: pagination.page,
              total: pagination.totalPages,
            })}
          </span>

          {pagination.hasNext ? (
            <Link
              href={buildPageUrl(page + 1, sort, location)}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
            >
              {t("storeBrandDetailPage.pagination.next")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function buildPageUrl(page: number, sort?: string, location: RequestLocation = {}) {
  const params = new URLSearchParams();
  params.set("page", page.toString());
  if (sort) params.set("sort", sort);
  if (location.lat) params.set("lat", location.lat);
  if (location.lng) params.set("lng", location.lng);
  if (location.radius) params.set("radius", location.radius);
  if (location.city) params.set("city", location.city);
  return `?${params.toString()}`;
}

function SortSelect({
  currentSort,
  slug,
  locale,
  location,
  labels,
}: {
  currentSort?: string;
  slug: string;
  locale: string;
  location: RequestLocation;
  labels: {
    placeholder: string;
    featured: string;
    bestSelling: string;
    aToZ: string;
    zToA: string;
    priceLowHigh: string;
    priceHighLow: string;
    newest: string;
  };
}) {
  const base = `/${locale}/brands/${slug}`;
  const sortHref = (sort?: string) => `${base}${buildPageUrl(1, sort, location)}`;
  return (
    <Select defaultValue={currentSort || "featured"}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={labels.placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="featured">
          <a href={sortHref()}>{labels.featured}</a>
        </SelectItem>
        <SelectItem value="best-selling">
          <a href={sortHref("best-selling")}>{labels.bestSelling}</a>
        </SelectItem>
        <SelectItem value="title-asc">
          <a href={sortHref("title-asc")}>{labels.aToZ}</a>
        </SelectItem>
        <SelectItem value="title-desc">
          <a href={sortHref("title-desc")}>{labels.zToA}</a>
        </SelectItem>
        <SelectItem value="price-asc">
          <a href={sortHref("price-asc")}>{labels.priceLowHigh}</a>
        </SelectItem>
        <SelectItem value="price-desc">
          <a href={sortHref("price-desc")}>{labels.priceHighLow}</a>
        </SelectItem>
        <SelectItem value="created-desc">
          <a href={sortHref("created-desc")}>{labels.newest}</a>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

function ProductsGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <ModernProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
