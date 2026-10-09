import { Skeleton } from "@/components/ui/skeleton";
import { ProductSkeleton } from "@/components/products/product-grid";

// Route-level fallback shown instantly on navigation while the server resolves
// the brand + product query. Mirrors the page layout (breadcrumb, brand hero,
// product grid) so content swaps in with minimal layout shift.
export default function BrandDetailLoading() {
  return (
    <div className="container mx-auto px-4 py-8" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading brand...
      </p>

      <Skeleton className="mb-6 h-5 w-64 max-w-full" />

      <section className="mb-8 overflow-hidden rounded-2xl border">
        <div className="flex flex-col items-center gap-6 p-6 text-center sm:p-10 md:flex-row md:items-center md:gap-8 md:text-left">
          <Skeleton className="h-28 w-28 shrink-0 rounded-2xl sm:h-32 sm:w-32" />
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="mx-auto h-4 w-20 md:mx-0" />
            <Skeleton className="mx-auto h-9 w-64 max-w-full md:mx-0" />
            <Skeleton className="mx-auto h-4 w-full max-w-2xl md:mx-0" />
            <Skeleton className="mx-auto h-6 w-36 rounded-full md:mx-0" />
          </div>
        </div>
      </section>

      <ProductSkeleton count={12} />
    </div>
  );
}
