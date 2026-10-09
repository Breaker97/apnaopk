import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level fallback shown instantly on navigation while the server resolves
// the category list. Mirrors categories/page.tsx (header + separator + card grid)
// so content swaps in with minimal layout shift.
//
// Lives in the (list) route group on purpose: at the categories/ segment level
// this list skeleton also wrapped categories/[slug], so a category page painted
// the index grid before its own fallback took over.
export default function CategoriesLoading() {
  return (
    <div className="container mx-auto px-4 py-8 lg:py-12" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading categories...
      </p>

      <Skeleton className="mb-4 h-5 w-44" />

      <div className="mb-8 space-y-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>

      <Separator className="mb-8" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-md border bg-background">
            <Skeleton className="aspect-4/3 w-full rounded-none" />
            <div className="p-3">
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
