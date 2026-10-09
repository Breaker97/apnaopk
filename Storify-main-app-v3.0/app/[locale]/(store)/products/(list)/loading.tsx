import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ProductSkeleton } from "@/components/products/product-skeleton";

// Route-level fallback shown instantly on navigation while the server resolves
// filters + the product query. Mirrors the page layout (header, filter
// sidebar, product grid) so content swaps in with minimal layout shift.
//
// Lives in the (list) route group on purpose: at the products/ segment level
// this grid skeleton also wrapped products/[slug], so a product detail page
// flashed a filter sidebar + 9-card grid before its own detail fallback.
export default function ProductsLoading() {
  return (
    <div className="container mx-auto px-4 py-8" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading products...
      </p>

      {/* Breadcrumb, then the title row — same order and heights as the page,
          so the real header swaps in without nudging the grid. */}
      <Skeleton className="mb-4 h-4 w-40" />

      <div className="mb-8 flex items-center justify-between gap-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-10 w-32" />
      </div>

      <Separator className="mb-8" />

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[260px_1fr]">
        <aside className="hidden space-y-6 lg:block">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ))}
        </aside>

        <ProductSkeleton count={12} />
      </div>
    </div>
  );
}
