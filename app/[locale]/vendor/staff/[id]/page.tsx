import { setRequestLocale } from "next-intl/server";
import { StaffDetailShell } from "@/components/admin/staff/staff-detail-shell";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { sellerPlanPermissions } from "@/lib/access/staff-authz";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditVendorStaffPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { vendor } = await requireVendorAreaAccess({
    locale,
    required: [
      VENDOR_PERMISSIONS.EDIT_STAFF,
      VENDOR_PERMISSIONS.MANAGE_STAFF,
      VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
    ],
  });
  // The boxes the plan does not give the seller are offered locked.
  const sellerPermissions = await sellerPlanPermissions(vendor._id);

  return <StaffDetailShell locale={locale} staffId={id} area="vendor" sellerPermissions={sellerPermissions} />;
}
