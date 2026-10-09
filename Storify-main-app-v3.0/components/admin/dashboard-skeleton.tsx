import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense fallbacks for the dashboard's streamed sections. Server components
 * on purpose: a placeholder that ships no JavaScript is one less thing between
 * the shell and the data it is standing in for.
 */
export function OrdersChartSkeleton() {
  return (
    <section className="overflow-hidden rounded-sm border-none bg-card shadow-sm">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-6 w-28" />
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Skeleton className="h-8 w-full sm:w-48" />
          <Skeleton className="h-8 w-full sm:w-32" />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px]">
        <div className="border-t p-4 sm:p-5 xl:border-t-0 xl:border-r">
          <div className="flex h-70 items-end gap-3 sm:h-85">
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton
                key={`dashboard-bar-skeleton-${index}`}
                className="w-full flex-1"
                style={{ height: `${30 + ((index * 37) % 60)}%` }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-center gap-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>

        <div className="space-y-5 border-t p-5 xl:border-t-0">
          <div className="flex items-center gap-6">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-1.5 w-full rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function RecentOrdersSkeleton() {
  return (
    <section className="rounded-sm border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-5 w-28" />
      </div>

      <div className="mt-4 space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={`dashboard-order-skeleton-${index}`}
            className="grid grid-cols-1 gap-4 rounded-sm border border-border px-4 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(260px,2.1fr)_1.1fr_0.6fr_0.8fr_1fr_0.7fr]"
          >
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-1">
              <Skeleton className="h-16 w-16 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            {Array.from({ length: 5 }).map((_, cell) => (
              <div
                key={`dashboard-order-cell-${index}-${cell}`}
                className="space-y-2"
              >
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function LatestProductsSkeleton() {
  return (
    <section className="rounded-sm border bg-card p-4 sm:p-5">
      <Skeleton className="h-6 w-36" />
      <div className="mt-5 divide-y divide-border">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`dashboard-product-skeleton-${index}`}
            className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function VisitorsChartSkeleton() {
  return (
    <section className="rounded-sm border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-6 w-24" />
        </div>
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="mt-4 h-[220px] w-full sm:h-[260px]" />
      <div className="mt-2 flex items-center justify-center gap-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>
    </section>
  );
}
