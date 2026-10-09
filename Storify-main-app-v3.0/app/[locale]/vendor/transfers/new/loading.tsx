import { TransferCreateSkeleton } from "@/components/admin/transfers/transfer-create-skeleton";

// Shadows vendor/transfers/(list)/loading.tsx, which would otherwise apply here and
// flash a list skeleton on the way to a form.
export default function VendorTransferNewLoading() {
  return <TransferCreateSkeleton />;
}
