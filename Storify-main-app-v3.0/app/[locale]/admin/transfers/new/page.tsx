import { setRequestLocale } from "next-intl/server";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { TransferCreateForm } from "@/components/admin/transfers/transfer-create-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminTransferCreatePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [
      STAFF_PERMISSIONS.CREATE_INVENTORY,
      STAFF_PERMISSIONS.MANAGE_INVENTORY,
    ],
  });

  return <TransferCreateForm locale={locale} />;
}
