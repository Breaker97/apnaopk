import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder for the transfer detail view while the record loads.
 *
 * Mirrors the view's own shape — back button + status pill, then the single
 * card with its meta tiles and line-items table — so the page keeps its layout
 * and nothing jumps when the record arrives. This replaced a centered spinner,
 * which collapsed the page to one short line and then reflowed the viewport.
 * The shared AdminFormSkeleton is not used here: it describes the sticky-header
 * 2/3 + 1/3 editor grid, which this read-only detail card is not.
 */
export function TransferDetailsSkeleton() {
  return (
    <div className="space-y-4 -mx-2 md:mx-0">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-4 w-64" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-lg border p-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-32 mt-2" />
              </div>
            ))}
          </div>

          {/* Reference/note block. Only some transfers carry one, so reserve a
              single line — the smallest shape the real block can take. */}
          <div className="rounded-lg border p-3">
            <Skeleton className="h-4 w-64" />
          </div>

          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-4 gap-4 border-b bg-muted/40 px-4 py-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-4 w-20" />
              ))}
            </div>
            {Array.from({ length: 4 }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="grid grid-cols-4 gap-4 border-b px-4 py-3 last:border-b-0"
              >
                <Skeleton className="h-4 w-full max-w-40" />
                <Skeleton className="h-4 w-full max-w-24" />
                <Skeleton className="h-4 w-full max-w-20" />
                <Skeleton className="h-4 w-10" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
