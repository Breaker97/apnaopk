import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";

// Counts mirror categories/page.tsx (5-cell strip) and
// components/admin/categories-data-table.tsx (4 tabs, 4 data columns).
export default function AdminCategoriesLoading() {
  return <AdminListSkeleton stats={5} columns={4} tabs={4} />;
}
