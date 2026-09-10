import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminStatsStripSkeleton } from "@/components/admin/admin-stats-strip";
import { cn } from "@/lib/utils";

/**
 * Route-level placeholder for the admin's list surfaces (categories,
 * collections, brands, inventory, reviews, transfers).
 *
 * The tables themselves already draw skeleton rows once they are mounted
 * (`loadingMode="rows"` in components/ui/data-table/data-table.tsx). The gap
 * this fills is earlier: those pages are server components that run Mongo
 * aggregations for the stats strip before they render anything at all, so the
 * route shows a blank frame until that finishes. Exported for use from
 * `loading.tsx`, which Next renders during exactly that window.
 *
 * Mirrors `AdminStatsStrip` (one card, N divided cells) and the commerce
 * `DataTable` (title row, tab strip, search row, header row, body, pagination).
 */

interface AdminListSkeletonProps {
  /** Stats-strip cells; 0 for pages without a strip (e.g. transfers). */
  stats?: number;
  /** Tailwind column class for the strip, matching the page's own. */
  statsColumnsClassName?: string;
  /** Table columns, excluding the checkbox and row-action columns. */
  columns?: number;
  rows?: number;
  /** Underline tabs in the toolbar; 0 to omit the tab strip. */
  tabs?: number;
  /** Leading select-all checkbox column. */
  selectable?: boolean;
  /** Trailing row-actions column. */
  rowActions?: boolean;
  /** First cell carries a 48px thumbnail (products, categories, reviews). */
  thumbnail?: boolean;
  /**
   * Buttons in the title row. Usually 1: `admin-commerce-table-header.ts` puts
   * Import/Export in the toolbar, not the header, so only the primary "Add …"
   * button lives here. Reviews has none.
   */
  headerActions?: number;
  /** The Import/Export pill on the right of the search row. */
  toolbarAction?: boolean;
  className?: string;
}

export function AdminListSkeleton({
  stats = 5,
  statsColumnsClassName,
  columns = 5,
  rows = 5,
  tabs = 4,
  selectable = true,
  rowActions = true,
  thumbnail = true,
  headerActions = 1,
  toolbarAction = true,
  className,
}: AdminListSkeletonProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {stats > 0 && (
        <AdminStatsStripSkeleton
          items={stats}
          columnsClassName={statsColumnsClassName}
        />
      )}

      <Card className="gap-0 space-y-0 rounded-[12px] border border-border bg-card p-6 shadow-none">
        {/* Title + primary action */}
        <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-7 w-40" />
          {headerActions > 0 && (
            <div className="flex items-center gap-2">
              {Array.from({ length: headerActions }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-36" />
              ))}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-[12px] border border-border bg-card shadow-none">
          {/* Tab strip */}
          {tabs > 0 && (
            <div className="flex items-center justify-between px-5 pt-5">
              <div className="flex items-center gap-5 pb-4">
                {Array.from({ length: tabs }).map((_, index) => (
                  <Skeleton key={index} className="h-4 w-16" />
                ))}
              </div>
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          )}

          {/* Search + filters */}
          <div className="flex flex-col gap-3 border-t px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <Skeleton className="h-9 w-full lg:max-w-[520px]" />
            {toolbarAction && <Skeleton className="h-8 w-32" />}
          </div>

          {/* Header row */}
          <div className="flex items-center gap-4 border-t px-6 py-4">
            {selectable && <Skeleton className="h-4 w-4 rounded-sm" />}
            {Array.from({ length: columns }).map((_, index) => (
              <Skeleton
                key={index}
                className={cn("h-4", index === 0 ? "w-32 flex-1" : "w-20")}
              />
            ))}
            {rowActions && <Skeleton className="ms-auto h-4 w-16" />}
          </div>

          {/* Body rows */}
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="flex items-center gap-4 border-t px-6 py-4"
            >
              {selectable && <Skeleton className="h-4 w-4 rounded-sm" />}
              {Array.from({ length: columns }).map((_, colIndex) =>
                colIndex === 0 ? (
                  <div
                    key={colIndex}
                    className="flex flex-1 items-center gap-3"
                  >
                    {thumbnail && (
                      <Skeleton className="h-12 w-12 shrink-0 rounded-md" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ) : (
                  <Skeleton key={colIndex} className="h-4 w-20" />
                ),
              )}
              {rowActions && (
                <Skeleton className="ms-auto h-8 w-24 rounded-md" />
              )}
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between pt-4">
          <Skeleton className="h-4 w-44" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </Card>
    </div>
  );
}
