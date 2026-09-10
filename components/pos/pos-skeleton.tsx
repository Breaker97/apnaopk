import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The product grid placeholder. Reused by the route-level `loading.tsx` and by
 * the terminal itself while a filter or search change is in flight, so the
 * layout never collapses to a bare spinner.
 */
export function POSProductGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:gap-4 sm:p-5 md:grid-cols-4 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex flex-col">
          <Skeleton className="aspect-square rounded-2xl" />
          <div className="space-y-2 px-1 pt-3">
            <Skeleton className="h-3.5 w-4/5 rounded" />
            <Skeleton className="h-3.5 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Full-page placeholder matching the terminal's real chrome: toolbar card,
 * category strip, product grid and cart column.
 */
export function POSPageSkeleton() {
  return (
    <div className="-mx-6 -my-6 flex h-[calc(100dvh-var(--dashboard-header-height,4rem))] flex-col overflow-hidden bg-muted/40 p-2 sm:p-3">
      {/* Toolbar */}
      <div className="shrink-0 rounded-2xl border border-border/60 bg-card p-2 shadow-sm sm:p-2.5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center xl:contents">
            <div className="flex min-w-0 items-center gap-2 lg:flex-1 xl:contents">
              <Skeleton className="h-11 min-w-0 flex-1 rounded-xl xl:h-10" />
              <Skeleton className="h-11 w-11 shrink-0 rounded-xl min-[360px]:w-24 lg:hidden" />
            </div>
            <div className="flex min-w-0 items-center gap-2 lg:flex-1 xl:contents">
              <Skeleton className="h-11 min-w-0 flex-1 rounded-xl xl:h-10 xl:w-65 xl:flex-none" />
              <Skeleton className="h-11 w-11 shrink-0 rounded-xl xl:h-10 xl:w-10" />
              <Skeleton className="h-11 w-11 shrink-0 rounded-xl xl:h-10 xl:w-10" />
              <Skeleton className="hidden h-11 w-11 shrink-0 rounded-xl sm:block xl:h-10 xl:w-10" />
            </div>
          </div>
          <div className="hidden items-center gap-2 lg:flex xl:contents">
            <Skeleton className="h-11 w-32 shrink-0 rounded-xl xl:h-10" />
            <Skeleton className="h-11 w-37.5 shrink-0 rounded-lg xl:h-10" />
            <Skeleton className="h-11 w-39.5 shrink-0 rounded-lg xl:h-10" />
            <Skeleton className="h-11 w-44.5 shrink-0 rounded-lg xl:h-10" />
          </div>
        </div>
      </div>

      {/* Terminal card */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm sm:mt-3">
        <div className="flex h-full min-h-0 flex-col overflow-hidden lg:flex-row">
          {/* Products */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 gap-2 px-3 pb-2.5 pt-2.5 sm:px-5 sm:pb-3 sm:pt-4">
              {[64, 96, 72, 88, 80].map((width, index) => (
                <Skeleton
                  key={index}
                  className={cn(
                    "h-9 shrink-0 rounded-full",
                    index > 2 && "hidden sm:block",
                  )}
                  style={{ width }}
                />
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <POSProductGridSkeleton />
            </div>
          </div>

          {/* Cart — the phone layout shows the product tab first, so this is
              desktop-only, matching the real terminal. */}
          <div className="hidden min-h-0 w-full flex-col bg-card lg:flex lg:w-105 lg:shrink-0 lg:border-l">
            <div className="shrink-0 space-y-4 p-5">
              <div className="space-y-2">
                <Skeleton className="h-2.5 w-12 rounded" />
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-3 w-16 rounded" />
              </div>
              <Skeleton className="h-14 w-full rounded-xl" />
            </div>
            <div className="min-h-0 flex-1" />
            <div className="shrink-0 space-y-3 border-t border-border/60 px-5 pb-5 pt-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3.5 w-28 rounded" />
                <Skeleton className="h-3.5 w-16 rounded" />
              </div>
              <div className="flex items-center justify-between border-t border-border/60 pt-3">
                <Skeleton className="h-3.5 w-20 rounded" />
                <Skeleton className="h-7 w-28 rounded" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-11 rounded-xl" />
                <Skeleton className="h-11 rounded-xl" />
                <Skeleton className="h-11 rounded-xl" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
