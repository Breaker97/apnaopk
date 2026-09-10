import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";

/**
 * Placeholder for the transfer create form during the route's server render.
 *
 * Unlike the record editors this form is a single full-width card rather than
 * the 2/3 + 1/3 grid `AdminFormSkeleton` describes, so it gets its own shape.
 * Exists so `transfers/new` shadows `admin/transfers/loading.tsx`, which would
 * otherwise paint a list skeleton on the way to a form.
 */
export function TransferCreateSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title={<Skeleton className="h-6 w-44" />}
        actions={
          <>
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-32" />
          </>
        }
      />

      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="space-y-5">
          {/* From / To location selects, each with an "Add location" button. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[0, 1].map((index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-7 w-28" />
                </div>
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>

          {/* Reference + internal note. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>

          <Skeleton className="h-10 w-full max-w-md" />

          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-5 gap-4 border-b bg-muted/40 px-4 py-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-20" />
              ))}
            </div>
            {Array.from({ length: 4 }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="grid grid-cols-5 gap-4 border-b px-4 py-3 last:border-b-0"
              >
                <Skeleton className="h-4 w-full max-w-40" />
                <Skeleton className="h-4 w-full max-w-24" />
                <Skeleton className="h-4 w-full max-w-20" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-9 w-28" />
              </div>
            ))}
          </div>

          <div className="border-t pt-4">
            <Skeleton className="h-4 w-48" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
