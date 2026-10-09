import { TransferDetailsSkeleton } from "@/components/admin/transfers/transfer-details-skeleton";

// Shadows admin/transfers/loading.tsx, which would otherwise apply here and
// flash a list skeleton before the detail view.
export default function AdminTransferDetailLoading() {
  return <TransferDetailsSkeleton />;
}
