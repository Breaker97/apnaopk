import { setRequestLocale } from "next-intl/server";
import { CampaignBannersTable } from "@/components/admin/campaign-banners/campaign-banners-table";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Online Store → Campaign Banner: the vendor's own popups and bars, shown on
 * their own store page. Reading takes the store-settings view grant, changing
 * takes the edit grant — the same ones the sliders use.
 */
export default async function VendorCampaignBannersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS],
  });
  const canEdit =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS);
  const scope = {
    apiBase: "/api/vendor/campaign-banners",
    basePath: "/vendor/online-store/campaign-banners",
    canEdit,
    vendor: true,
  };

  return (
    <div className="w-full space-y-4">
      <CampaignBannersTable scope={scope} />
    </div>
  );
}
