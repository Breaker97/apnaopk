import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  clampDesktopColumns,
  PRODUCT_GRID_DESKTOP_COLUMN_CLASSES,
} from "./product-grid-columns";

const PRODUCT_DESKTOP_COLUMN_CLASSES: Record<number, string> = {
  2: "lg:auto-cols-[calc((100%_-_1.25rem)_/_2)]",
  3: "lg:auto-cols-[calc((100%_-_2.5rem)_/_3)]",
  4: "lg:auto-cols-[calc((100%_-_3.75rem)_/_4)]",
  5: "lg:auto-cols-[calc((100%_-_5rem)_/_5)]",
  6: "lg:auto-cols-[calc((100%_-_6.25rem)_/_6)]",
};

const ARTICLE_DESKTOP_COLUMN_CLASSES: Record<number, string> = {
  2: "lg:basis-[calc((100%_-_1.25rem)_/_2)]",
  3: "lg:basis-[calc((100%_-_2.5rem)_/_3)]",
  4: "lg:basis-[calc((100%_-_3.75rem)_/_4)]",
};

// Per-section skeletons shared by the route-level `loading.tsx` fallback and the
// per-section <Suspense> boundaries in the home page. Keeping them here gives a
// single source of truth so the placeholder dimensions stay matched to the real
// sections (minimal CLS when the streamed content swaps in).

export function HeroSkeleton() {
  return (
    <section className="py-4 lg:py-6">
      <div className="container mx-auto px-4">
        {/* Matches HeroSlider's aspect ratio to avoid layout shift. */}
        <Skeleton className="aspect-1360/314 w-full rounded-md" />
      </div>
    </section>
  );
}

export function FeaturedCategoriesSkeleton() {
  return (
    <section className="py-6 lg:py-8">
      <div className="container mx-auto px-4">
        <Skeleton className="h-8 w-52 sm:h-9 sm:w-64" />
        <div className="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-4 sm:gap-6 md:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-3"
              aria-hidden="true"
            >
              <Skeleton className="h-20 w-full max-w-27.5 rounded-xl sm:h-24" />
              <Skeleton className="h-3.5 w-20 sm:w-24" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card" aria-hidden="true">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-8 w-18 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function NewArrivalsSkeleton({
  desktopColumns = 4,
}: {
  desktopColumns?: number;
} = {}) {
  const normalizedDesktopColumns = Number.isFinite(desktopColumns)
    ? Math.floor(desktopColumns)
    : 4;
  const safeDesktopColumns = Math.min(
    6,
    Math.max(2, normalizedDesktopColumns),
  );

  return (
    <section className="py-8 lg:py-10">
      <div className="container mx-auto px-4">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-44 sm:w-56" />
            <Skeleton className="h-4 w-60 sm:w-72" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </div>

        <div
          className={cn(
            "grid auto-cols-[46%] grid-flow-col gap-3 overflow-hidden sm:auto-cols-[48%] sm:gap-5 md:auto-cols-[32%]",
            PRODUCT_DESKTOP_COLUMN_CLASSES[safeDesktopColumns],
          )}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function PromotionsOffersSkeleton() {
  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 gap-2.5 sm:gap-5 md:grid-cols-4 md:grid-rows-2">
          <Skeleton className="col-span-1 row-span-2 aspect-317/565 rounded-sm sm:rounded-md" />
          <Skeleton className="col-span-1 row-span-2 aspect-317/565 rounded-sm sm:rounded-md" />
          <Skeleton className="col-span-1 row-span-1 aspect-317/272 rounded-sm sm:rounded-md" />
          <Skeleton className="col-span-1 row-span-1 aspect-317/272 rounded-sm sm:rounded-md" />
          <Skeleton className="col-span-2 row-span-1 aspect-654/272 rounded-sm sm:rounded-md" />
        </div>
      </div>
    </section>
  );
}

export function TopVendorsSkeleton() {
  return (
    <section className="py-8 lg:py-10">
      <div className="container mx-auto px-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Skeleton className="h-8 w-40 sm:w-48" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-2xl border bg-card p-3"
              aria-hidden="true"
            >
              <Skeleton className="aspect-293/132 w-full rounded-xl" />
              <div className="relative px-1 pb-1 pt-9">
                <Skeleton className="absolute -top-6 left-1 h-12 w-12 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="mt-4 h-14 w-full rounded-xl" />
                <Skeleton className="mt-4 h-11 w-full rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FeaturedProductsSkeleton({
  desktopColumns = 4,
}: {
  desktopColumns?: number;
} = {}) {
  const safeDesktopColumns = clampDesktopColumns(desktopColumns);

  return (
    <section className="py-6 lg:py-12">
      <div className="container mx-auto px-4">
        <Skeleton className="h-8 w-56 sm:w-72" />

        <div className="mt-4 mb-7 flex flex-wrap items-center gap-3 sm:mt-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-26 rounded-full" />
          ))}
          <Skeleton className="ml-auto h-10 w-24 rounded-full" />
        </div>

        <div
          className={cn(
            "grid grid-cols-2 gap-5 md:grid-cols-3",
            PRODUCT_GRID_DESKTOP_COLUMN_CLASSES[safeDesktopColumns],
          )}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function TopArticlesSkeleton({
  desktopColumns = 4,
}: {
  desktopColumns?: number;
} = {}) {
  const normalizedDesktopColumns = Number.isFinite(desktopColumns)
    ? Math.floor(desktopColumns)
    : 4;
  const safeDesktopColumns = Math.min(
    4,
    Math.max(2, normalizedDesktopColumns),
  );

  return (
    <section className="py-5 lg:py-10">
      <div className="container mx-auto px-4">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Skeleton className="h-8 w-44 sm:w-56" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </div>

        <div className="flex gap-3 overflow-hidden sm:gap-4 lg:gap-5">
          {Array.from({ length: safeDesktopColumns }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "min-h-87.5 shrink-0 basis-[78%] overflow-hidden rounded-xl border bg-card sm:basis-[48%]",
                ARTICLE_DESKTOP_COLUMN_CLASSES[safeDesktopColumns],
              )}
              aria-hidden="true"
            >
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="space-y-4 p-5 lg:p-6">
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <div className="pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-3.5 w-24" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                    <Skeleton className="h-9 w-24 rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function BecomeVendorSkeleton() {
  return (
    <section className="py-6 lg:py-10">
      <div className="container mx-auto px-4">
        <div className="rounded-sm border p-6 sm:p-8 lg:p-10">
          <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto]">
            <div className="space-y-4">
              <Skeleton className="h-9 w-3/4 sm:w-2/3" />
              <Skeleton className="h-4 w-full sm:w-5/6" />
            </div>
            <Skeleton className="h-12 w-44 rounded-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
