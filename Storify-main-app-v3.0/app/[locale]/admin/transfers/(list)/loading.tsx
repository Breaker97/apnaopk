import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";

// No stats strip on this page. Counts mirror
// components/admin/transfers/transfers-list.tsx (6 tabs, 6 data columns), which
// declares neither selection nor row actions and renders no thumbnail.
export default function AdminTransfersLoading() {
  return (
    <AdminListSkeleton
      stats={0}
      columns={6}
      tabs={6}
      selectable={false}
      rowActions={false}
      thumbnail={false}
    />
  );
}
