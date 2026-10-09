import { setRequestLocale } from "next-intl/server";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { GlobalVariantsManager } from "@/components/admin/global-variants-manager";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminGlobalVariantsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_PRODUCTS],
  });

  return <GlobalVariantsManager />;
}
