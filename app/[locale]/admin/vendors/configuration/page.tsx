import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { getSanitizedSettings } from "@/lib/settings/sanitize-settings";
import { isMultiVendorEnabled } from "@/lib/vendors/multi-vendor";
import { AdminSettingsProvider } from "@/components/admin/settings/admin-settings-context";
import { VendorConfigurationScreen } from "@/components/admin/vendor-configuration-screen";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminVendorConfigurationPage({
  params,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  // Vendor features live entirely under multi-vendor mode; in single-vendor
  // mode this surface does not exist (the Vendors nav group is hidden too).
  if (!(await isMultiVendorEnabled())) {
    redirect(`/${locale}/admin`);
  }

  // Seed the settings client store server-side (same as the settings layout) so
  // the config renders its real values on first paint without a round-trip.
  const initialSettings = await getSanitizedSettings();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <AdminSettingsProvider initialSettings={initialSettings}>
        <VendorConfigurationScreen />
      </AdminSettingsProvider>
    </div>
  );
}
