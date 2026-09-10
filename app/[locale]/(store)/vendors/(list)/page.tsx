import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { BadgeCheck, Star, Store } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { AppImage } from "@/components/ui/app-image";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { ElectronicsPager } from "@/components/store/electronics-pager";
import { formatVendorCount } from "@/components/store/vendor-storefront-header";
import { buildStorefrontAlternates } from "@/lib/storefront/storefront-metadata";
import {
  getStorefrontVendorDirectory,
  type StorefrontVendorDirectoryEntry,
} from "@/lib/storefront/storefront-vendors";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** 24 fills whole rows at every breakpoint (1, 2, 3 and 4 columns). */
const PAGE_SIZE = 24;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });

  return {
    title: t("nav.vendors"),
    description: t("vendor.directory.subtitle"),
    alternates: await buildStorefrontAlternates({ locale, page: "/vendors" }),
  };
}

export default async function VendorsPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, search] = await Promise.all([
    getTranslations({ locale }),
    searchParams,
  ]);

  const requestedPage = Number(
    Array.isArray(search.page) ? search.page[0] : search.page,
  );
  const directory = await getStorefrontVendorDirectory(
    Number.isFinite(requestedPage) ? requestedPage : 1,
    PAGE_SIZE,
  );

  // Single-vendor stores have no marketplace to browse.
  if (!directory) notFound();

  const { vendors, page, totalPages } = directory;

  return (
    <div className="container mx-auto px-4 py-8 lg:py-12">
      <StoreBreadcrumb
        className="mb-4"
        locale={locale}
        items={[{ label: t("nav.vendors") }]}
      />

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          {t("nav.vendors")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
          {t("vendor.directory.subtitle")}
        </p>
      </div>

      <Separator className="mb-8" />

      {vendors.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Store className="h-10 w-10 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">{t("vendor.directory.empty")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {vendors.map((vendor) => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              locale={locale}
              verifiedLabel={t("vendor.storefront.verified")}
              productsLabel={t("vendor.directory.products", {
                count: formatVendorCount(vendor.productCount, locale),
              })}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-10 flex justify-center">
          <ElectronicsPager
            page={page}
            totalPages={totalPages}
            pageHref={(target) =>
              target === 1
                ? `/${locale}/vendors`
                : `/${locale}/vendors?page=${target}`
            }
            previousLabel={t("common.previous")}
            nextLabel={t("common.next")}
          />
        </div>
      )}
    </div>
  );
}

function VendorCard({
  vendor,
  locale,
  verifiedLabel,
  productsLabel,
}: {
  vendor: StorefrontVendorDirectoryEntry;
  locale: string;
  verifiedLabel: string;
  productsLabel: string;
}) {
  return (
    <Link
      href={`/${locale}/vendors/${vendor.slug}`}
      className="group overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-293/132 w-full overflow-hidden bg-muted">
        {vendor.banner ? (
          <AppImage
            src={vendor.banner}
            alt=""
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Store className="h-8 w-8 text-muted-foreground/60" aria-hidden />
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border bg-background">
            {vendor.logo ? (
              <AppImage
                src={vendor.logo}
                alt=""
                fill
                className="object-cover"
                sizes="48px"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Store
                  className="h-5 w-5 text-muted-foreground/60"
                  aria-hidden
                />
              </div>
            )}
          </div>

          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold leading-5">
              <span className="truncate">{vendor.storeName}</span>
              {vendor.verified && (
                <BadgeCheck
                  className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-label={verifiedLabel}
                />
              )}
            </h2>
            <div className="mt-1 flex items-center gap-2 text-[13px] leading-4 text-muted-foreground">
              {vendor.reviewCount > 0 && (
                <span className="flex items-center gap-1">
                  <Star
                    className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
                    aria-hidden
                  />
                  {vendor.rating.toFixed(1)} (
                  {formatVendorCount(vendor.reviewCount, locale)})
                </span>
              )}
              <span className="truncate">{productsLabel}</span>
            </div>
          </div>
        </div>

        {vendor.description && (
          <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
            {vendor.description}
          </p>
        )}
      </div>
    </Link>
  );
}
