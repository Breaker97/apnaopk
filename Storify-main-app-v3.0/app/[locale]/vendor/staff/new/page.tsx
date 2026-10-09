import { setRequestLocale } from "next-intl/server";
import { StaffForm } from "@/components/admin/staff-form";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewVendorStaffPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireVendorAreaAccess({
    locale,
    required: [
      VENDOR_PERMISSIONS.CREATE_STAFF,
      VENDOR_PERMISSIONS.MANAGE_STAFF,
      VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
    ],
  });

  return <StaffForm locale={locale} area="vendor" />;
}
