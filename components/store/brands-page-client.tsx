"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ImageOff, Loader2, PackageSearch } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { Skeleton } from "@/components/ui/skeleton";
import { type Locale } from "@/config/i18n.config";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

type StoreBrand = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  productCount?: number;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

interface BrandsPageClientProps {
  locale: Locale;
  initialBrands: StoreBrand[];
  initialPagination: Pagination;
}

const PAGE_SIZE = 20;

export function BrandsPageClient({
  locale,
  initialBrands,
  initialPagination,
}: BrandsPageClientProps) {
  const [brands, setBrands] = useState(initialBrands);
  const [page, setPage] = useState(initialPagination.page || 1);
  const [hasNext, setHasNext] = useState(initialPagination.hasNext);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // A router.refresh() (StorefrontRefresh after back/forward nav or tab
  // refocus) delivers a new initialBrands. The top of the list mirrors the
  // server's first page, so when that page actually changes restart from it;
  // infinite scroll re-fills the tail. The content comparison keeps no-op
  // refreshes (same data, new array identity) from collapsing a scrolled list.
  useApplyOnChange(
    [initialBrands, initialPagination.page, initialPagination.hasNext, brands],
    () => {
      const firstPageUnchanged =
        brands.length >= initialBrands.length &&
        initialBrands.every((next, index) => {
          const current = brands[index];
          return (
            current._id === next._id &&
            current.name === next.name &&
            current.logo === next.logo &&
            current.productCount === next.productCount
          );
        });
      if (firstPageUnchanged) return;

      setBrands(initialBrands);
      setPage(initialPagination.page || 1);
      setHasNext(initialPagination.hasNext);
    },
  );

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasNext) return;

    setIsLoadingMore(true);
    setHasLoadError(false);

    try {
      const nextPage = page + 1;
      const response = await fetch(
        `/api/brands/public?flat=true&page=${nextPage}&limit=${PAGE_SIZE}`,
      );
      const result = await response.json();
      const nextBrands = Array.isArray(result?.data?.data)
        ? (result.data.data as StoreBrand[])
        : [];
      const pagination = result?.data?.pagination as Pagination | undefined;

      setBrands((current) => {
        const seen = new Set(current.map((brand) => brand._id));
        const additions = nextBrands.filter((brand) => !seen.has(brand._id));
        return [...current, ...additions];
      });
      setPage(pagination?.page ?? nextPage);
      setHasNext(Boolean(pagination?.hasNext));
    } catch {
      setHasLoadError(true);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasNext, isLoadingMore, page]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNext) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "420px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNext, loadMore]);

  if (brands.length === 0) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-md border bg-background px-6 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-md bg-muted">
          <PackageSearch className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">No brands yet</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Brands will appear here when they are published.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {brands.map((brand) => (
          <Link
            key={brand._id}
            href={`/${locale}/brands/${encodeURIComponent(brand.slug)}`}
            className="group overflow-hidden rounded-md border bg-background transition-colors hover:border-primary/45"
          >
            <div className="relative aspect-4/3 bg-muted/45">
              {brand.logo ? (
                <AppImage
                  src={brand.logo}
                  alt={brand.name}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                  className="object-contain p-6 transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-muted-foreground/55">
                  <ImageOff className="h-8 w-8" />
                </div>
              )}
            </div>

            <div className="space-y-2 p-3 sm:p-4">
              <div>
                <h2 className="line-clamp-1 text-sm font-semibold text-foreground sm:text-base">
                  {brand.name}
                </h2>
                {brand.description ? (
                  <p className="mt-1 line-clamp-2 min-h-9 text-xs leading-4 text-muted-foreground">
                    {brand.description}
                  </p>
                ) : (
                  <p className="mt-1 min-h-9 text-xs leading-4 text-muted-foreground">
                    {brand.productCount || 0}{" "}
                    {brand.productCount === 1 ? "product" : "products"}
                  </p>
                )}
              </div>

              <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                View products
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div ref={sentinelRef} className="h-12" aria-hidden="true" />

      {isLoadingMore ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-md border bg-background">
              <Skeleton className="aspect-4/3 rounded-b-none rounded-t-md" />
              <div className="space-y-2 p-3 sm:p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {hasLoadError ? (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4" />
          More brands could not be loaded.
        </div>
      ) : null}
    </>
  );
}
