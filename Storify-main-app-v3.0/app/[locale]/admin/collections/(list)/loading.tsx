import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";

// Counts mirror collections/page.tsx (5-cell strip) and
// components/admin/collections-data-table.tsx (3 tabs, 5 data columns).
export default function AdminCollectionsLoading() {
  return <AdminListSkeleton stats={5} columns={5} tabs={3} />;
}
