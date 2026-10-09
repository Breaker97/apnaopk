import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level fallback shown instantly on navigation while the server resolves
// the vendor directory. Mirrors vendors/(list)/page.tsx (header + separator +
// card grid).
//
// Lives in the (list) route group on purpose: at the vendors/ segment level
// this skeleton would also wrap vendors/[slug], painting the directory grid
// before a store page's own fallback took over.
export default function VendorsLoading() {
  return (
    <div className="container mx-auto px-4 py-8 lg:py-12" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading vendors...
      </p>

      <Skeleton className="mb-4 h-5 w-40" />

      <div className="mb-8 space-y-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>

      <Separator className="mb-8" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border bg-card">
            <Skeleton className="aspect-293/132 w-full rounded-none" />
            <div className="flex items-center gap-3 p-4">
              <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
