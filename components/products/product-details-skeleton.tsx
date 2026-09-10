import { Skeleton } from "@/components/ui/skeleton";
import {
  GALLERY_STACK_CLASS,
  MEDIA_FRAME_CLASS,
  THUMBNAIL_ROW_CLASS,
  THUMBNAIL_TILE_CLASS,
} from "@/components/products/gallery-layout";
import { cn } from "@/lib/utils";

// Skeletons for the product detail route. Dimensions mirror the real
// components (product-details.tsx, product-image-gallery.tsx, reviews-list.tsx,
// modern-product-card.tsx) so the route-level loading.tsx swaps to real content
// with minimal layout shift.

export function ProductDetailsSkeleton() {
  return (
    <div className="space-y-14" aria-hidden="true">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10 xl:gap-12">
        {/* Gallery — sticky on lg, matches ProductImageGallery */}
        <div className="lg:sticky lg:top-[calc(var(--storefront-header-height,4rem)+1.5rem)] lg:self-start">
          <div className={GALLERY_STACK_CLASS}>
            <Skeleton className={cn(MEDIA_FRAME_CLASS, "rounded-lg")} />
            <div className={THUMBNAIL_ROW_CLASS}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className={THUMBNAIL_TILE_CLASS} />
              ))}
            </div>
          </div>
        </div>

        {/* Buy box — same stacked width cap the real column carries */}
        <div className="mx-auto w-full max-w-xl lg:max-w-none">
          <div className="space-y-8">
            <div className="space-y-4">
              {/* brand */}
              <Skeleton className="h-4 w-24" />
              {/* title */}
              <Skeleton className="h-8 w-3/4 lg:h-9" />
              {/* rating row */}
              <div className="flex items-center gap-1.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-4 rounded-sm" />
                ))}
                <Skeleton className="ml-1 h-4 w-24" />
              </div>
              {/* price + stock badge */}
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-7 w-24 rounded-md" />
              </div>
              {/* short description */}
              <div className="space-y-2">
                <Skeleton className="h-4 w-full max-w-2xl" />
                <Skeleton className="h-4 w-4/5 max-w-2xl" />
              </div>
            </div>

            {/* options: color swatches + size pills */}
            <div className="space-y-6">
              <div className="space-y-2">
                <Skeleton className="h-5 w-16" />
                <div className="flex flex-wrap gap-2.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-8 rounded-full" />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Skeleton className="h-5 w-16" />
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-14 rounded-sm" />
                  ))}
                </div>
              </div>
            </div>

            {/* quantity stepper + actions */}
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-12 w-40 rounded-[10px]" />
              <div className="flex min-w-65 flex-1 items-center gap-3">
                <Skeleton className="h-12 flex-1 rounded-sm" />
                <Skeleton className="h-12 flex-1 rounded-sm" />
              </div>
            </div>

            {/* share row */}
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-9 rounded-full" />
              ))}
            </div>

            <div className="h-px w-full bg-border/80" />

            {/* collapsible sections */}
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between border-b border-border/60 py-4"
                >
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-5 w-5 rounded-sm" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + description */}
      <section className="py-8">
        <div className="mb-8 flex items-center gap-2 border-b border-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-sm" />
          ))}
        </div>
        <div className="max-w-4xl space-y-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </section>
    </div>
  );
}

// Mirrors ReviewsListSkeleton in reviews-list.tsx (same heading, summary bar
// and three-entry thread) so the lazy chunk swapping in does not reshape it.
export function ReviewsSkeleton() {
  return (
    <div className="py-8" aria-hidden="true">
      <Skeleton className="mb-5 h-8 w-36" />
      <div className="flex items-center gap-4 border-t border-border pt-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="ms-auto h-8 w-56" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3 py-8">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-52" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Matches the 4-up related-products grid (modern-product-card layout).
export function RelatedProductsSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4"
      aria-hidden="true"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border bg-card">
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
      ))}
    </div>
  );
}
