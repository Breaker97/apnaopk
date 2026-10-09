import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// This page heads with `ReviewsStatsCard`, a rating summary rather than an
// `AdminStatsStrip`, so the strip is switched off and stood in for by a plain
// block: the real card is pinned to 181px from `lg` up and stacks to roughly
// 300px below it. Counts mirror components/admin/reviews-data-table.tsx
// (5 tabs, 5 data columns).
export default function AdminReviewsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[300px] w-full rounded-[12px] lg:h-[181px]" />
      <AdminListSkeleton
        stats={0}
        columns={5}
        tabs={5}
        headerActions={0}
        toolbarAction={false}
      />
    </div>
  );
}
