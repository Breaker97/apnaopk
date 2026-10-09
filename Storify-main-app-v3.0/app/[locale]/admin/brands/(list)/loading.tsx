import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";

// Counts mirror brands/page.tsx (5-cell strip) and
// components/admin/brands-data-table.tsx (7 tabs, 5 data columns).
export default function AdminBrandsLoading() {
  return <AdminListSkeleton stats={5} columns={5} tabs={7} toolbarAction={false} />;
}
