import { setRequestLocale } from "next-intl/server";
import { CampaignBannerEditor } from "@/components/admin/campaign-banners/campaign-banner-editor";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditVendorCampaignBannerPage({ params }: PageProps) {
  const { locale, id } = await params;
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

  return <CampaignBannerEditor bannerId={id} scope={scope} />;
}
