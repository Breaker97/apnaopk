import { notFound, redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ActivityLogListView } from "@/components/admin/activity-log/activity-log-list-view";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { localeHref } from "@/lib/i18n/locale-routing";
import { getSettings } from "@/models/settings.model";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * What a store's own team did: "My activity" (the owner) and, with `view_staff`,
 * "Staff activity". The same guards as the vendor customers page. "My activity"
 * needs no permission of its own beyond owning an approved store; the staff tab
 * is the only part `view_staff` gates, and the list refuses it server-side.
 */
export default async function VendorActivityLogPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireVendorAreaAccess({ locale });

  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) notFound();

  // A store still in its unpaid setup window reaches the dashboard, not this:
  // `requireApprovedVendorByUserId` would refuse it with an error page.
  if (!access.isApproved) redirect(await localeHref(locale, "/vendor/dashboard"));

  const vendor = await requireApprovedVendorByUserId(access.session.user.id);

  return (
    <ActivityLogListView
      area="vendor"
      searchParams={search}
      viewer={{
        vendorId: String(vendor._id),
        ownerUserId: String(vendor.userId),
        canViewStaff: access.vendorPermissions.includes(VENDOR_PERMISSIONS.VIEW_STAFF),
      }}
    />
  );
}
