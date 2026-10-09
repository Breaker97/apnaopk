import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholders for the order details screen.
 *
 * `OrderDetailsSkeleton` stands in for the whole route while the order query
 * runs (`loading.tsx`); `OrderTimelineSkeleton` fills the one card the page
 * streams separately, so the order header, items and customer panel are
 * already readable while the audit trail is still loading.
 */

export function OrderTimelineSkeleton() {
  return (
    <Card className="gap-2">
      <CardHeader className="pb-4">
        <Skeleton className="h-5 w-28" />
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Comment composer */}
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-md" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-8 w-16" />
          </div>
        </div>

        {/* One comment card, then compact event lines — the usual mix. */}
        <div className="space-y-4 border-l border-border pl-6">
          <div className="relative">
            <Skeleton className="absolute left-[-2.375rem] top-0 h-7 w-7 rounded-full" />
            <div className="space-y-2 rounded-md border border-border p-3">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="relative">
              <Skeleton className="absolute left-[-2.125rem] top-0.5 h-5 w-5 rounded-full" />
              <div className="flex flex-wrap items-baseline gap-2 py-0.5">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OrderItemsSkeleton() {
  return (
    <Card className="gap-4 p-0">
      <CardHeader className="pt-6">
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex items-center gap-4 border-b px-6 py-3">
          <Skeleton className="h-3 w-16 flex-1" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-14" />
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 border-b px-6 py-4">
            <div className="flex flex-1 items-start gap-4">
              <Skeleton className="h-16 w-16 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
        <div className="space-y-3 border-t bg-muted/50 p-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
          <div className="flex items-center justify-between border-t pt-3">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OrderCustomerSkeleton() {
  return (
    <Card className="gap-4">
      <CardHeader>
        <Skeleton className="h-5 w-24" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2 border-t pt-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function OrderDetailsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header: title, status badges, action buttons */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-6 w-16 rounded-md" />
            <Skeleton className="h-6 w-24 rounded-md" />
          </div>
          <Skeleton className="h-4 w-52" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <OrderItemsSkeleton />
          <OrderTimelineSkeleton />
        </div>
        <div className="lg:col-span-1">
          <OrderCustomerSkeleton />
        </div>
      </div>
    </div>
  );
}
