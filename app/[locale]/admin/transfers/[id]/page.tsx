import { setRequestLocale } from "next-intl/server";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { TransferDetails } from "@/components/admin/transfers/transfer-details";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function AdminTransferDetailsPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_INVENTORY],
  });

  return <TransferDetails locale={locale} transferId={id} />;
}
