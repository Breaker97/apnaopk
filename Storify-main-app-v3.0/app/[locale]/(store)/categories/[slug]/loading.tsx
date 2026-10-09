import { Skeleton } from "@/components/ui/skeleton";
import { ProductSkeleton } from "@/components/products/product-grid";

// Route-level fallback shown instantly on navigation while the server resolves
// the category + product query. Mirrors the page layout (breadcrumb, category
// header card, product grid) so content swaps in with minimal layout shift.
export default function CategoryDetailLoading() {
  return (
    <div className="container mx-auto px-4 py-8" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading category...
      </p>

      <Skeleton className="mb-6 h-5 w-64 max-w-full" />

      <section className="mb-8 grid gap-6 rounded-md border bg-background p-5 sm:grid-cols-[180px_1fr] sm:p-6">
        <Skeleton className="aspect-square rounded-md" />
        <div className="flex min-w-0 flex-col justify-center space-y-3">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-4 w-2/3 max-w-xl" />
          <Skeleton className="h-4 w-40" />
        </div>
      </section>

      <ProductSkeleton count={12} />
    </div>
  );
}
