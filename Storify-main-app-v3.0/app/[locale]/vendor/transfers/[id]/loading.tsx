import { TransferDetailsSkeleton } from "@/components/admin/transfers/transfer-details-skeleton";

// Shadows vendor/transfers/(list)/loading.tsx, which would otherwise apply here and
// flash a list skeleton before the detail view.
export default function VendorTransferDetailLoading() {
  return <TransferDetailsSkeleton />;
}
