import { TransferCreateSkeleton } from "@/components/admin/transfers/transfer-create-skeleton";

// Shadows admin/transfers/loading.tsx, which would otherwise apply here and
// flash a list skeleton on the way to a form.
export default function AdminTransferNewLoading() {
  return <TransferCreateSkeleton />;
}
