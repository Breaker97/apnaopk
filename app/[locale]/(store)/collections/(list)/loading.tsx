import { Skeleton } from "@/components/ui/skeleton";
import { ProductSkeleton } from "@/components/products/product-grid";

// Route-level fallback shown instantly on navigation while the server resolves
// the collections list. Mirrors the page layout (header, collections grid,
// products grid) so content swaps in with minimal layout shift.
//
// Lives in the (list) route group on purpose: at the collections/ segment level
// this list skeleton also wrapped collections/[slug], so a collection page
// painted the index grid before its own fallback took over.
export default function CollectionsLoading() {
  return (
    <div className="container mx-auto px-4 py-8 lg:py-12" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading collections...
      </p>

      <Skeleton className="mb-4 h-5 w-44" />

      <div className="mb-10">
        <Skeleton className="h-9 w-96 max-w-full" />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 sm:gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-sm border">
            <Skeleton className="aspect-2/1 w-full rounded-none" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12">
        <ProductSkeleton count={8} />
      </div>
    </div>
  );
}
