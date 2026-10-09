import { TransferCreateSkeleton } from "@/components/admin/transfers/transfer-create-skeleton";

// Shadows admin/transfers/[id]/loading.tsx, which would otherwise flash the
// detail skeleton on the way to a form.
export default function AdminTransferEditLoading() {
  return <TransferCreateSkeleton />;
}
