import { setRequestLocale } from "next-intl/server";
import { StaffForm } from "@/components/admin/staff-form";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { sellerPlanPermissions } from "@/lib/access/staff-authz";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewVendorStaffPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { vendor } = await requireVendorAreaAccess({
    locale,
    required: [
      VENDOR_PERMISSIONS.CREATE_STAFF,
      VENDOR_PERMISSIONS.MANAGE_STAFF,
      VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
    ],
  });
  // The boxes the plan does not give the seller are offered locked.
  const sellerPermissions = await sellerPlanPermissions(vendor._id);

  return <StaffForm locale={locale} area="vendor" sellerPermissions={sellerPermissions} />;
}
