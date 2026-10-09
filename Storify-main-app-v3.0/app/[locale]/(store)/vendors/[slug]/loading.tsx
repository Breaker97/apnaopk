import { Skeleton } from "@/components/ui/skeleton";
import { ProductSkeleton } from "@/components/products/product-skeleton";

// Route-level fallback shown instantly on navigation while the server resolves
// the vendor + product query. Mirrors the page layout — capped banner with an
// overlapping logo, trust row, fact pills, store-info panel, filter sidebar,
// toolbar, product grid — so content swaps in with minimal layout shift. Keep
// this in step with page.tsx and vendor-storefront-header.tsx: a skeleton that
// disagrees with the real layout reads as a flash, not as loading.
export default function VendorStorefrontLoading() {
  return (
    <div className="container mx-auto px-4 py-6 sm:py-8" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading store...
      </p>

      <Skeleton className="mb-4 h-5 w-56 max-w-full" />

      <section>
        <Skeleton className="aspect-[1360/314] max-h-40 w-full rounded-xl lg:max-h-48" />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <Skeleton className="-mt-10 ms-4 h-20 w-20 shrink-0 rounded-2xl border-[3px] border-background sm:-mt-11 sm:ms-5 sm:h-24 sm:w-24" />
          <div className="min-w-0 flex-1 sm:pt-3">
            <Skeleton className="h-8 w-56 max-w-full" />
            <Skeleton className="mt-1 h-5 w-full max-w-md" />
            <Skeleton className="mt-3 h-4 w-56 max-w-full" />

            <div className="mt-3 flex flex-wrap gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-32 rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </section>

      <Skeleton className="mt-6 h-12 w-full rounded-xl sm:mt-8 lg:hidden" />

      <div className="mt-6 flex gap-6 border-b pb-3 sm:mt-8">
        {[80, 56, 128, 72].map((width) => (
          <Skeleton key={width} className="h-5" style={{ width }} />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 sm:mt-8 lg:grid-cols-[288px_1fr] lg:gap-10">
        <aside className="hidden space-y-6 lg:block">
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-8 w-20 rounded-lg" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          </div>

          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ))}
        </aside>

        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-[172px] rounded-md" />
          </div>

          <ProductSkeleton count={8} />
        </div>
      </div>
    </div>
  );
}
