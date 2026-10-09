import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { VendorSettingsForm } from "@/components/vendor/vendor-settings-form";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VendorSettingsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS],
  });
  const canEditStoreSettings =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS);
  const canManageChannels = access.vendorPermissions.includes(
    VENDOR_PERMISSIONS.MANAGE_CHANNELS,
  );

  const initialTab =
    typeof search.tab === "string" ? search.tab : undefined;

  return (
    <VendorSettingsForm
      initialTab={initialTab}
      canEdit={canEditStoreSettings}
      canManageChannels={canManageChannels}
    />
  );
}
