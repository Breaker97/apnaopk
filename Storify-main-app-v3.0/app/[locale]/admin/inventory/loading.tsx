import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";

// Counts mirror inventory/page.tsx (5-cell strip) and
// components/admin/inventory-data-table.tsx (4 tabs, 7 data columns).
export default function AdminInventoryLoading() {
  return <AdminListSkeleton stats={5} columns={7} tabs={4} />;
}
