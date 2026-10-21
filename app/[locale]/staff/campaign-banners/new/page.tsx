import "server-only";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { CampaignBannerEditor } from "@/components/admin/campaign-banners/campaign-banner-editor";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { hasStaffScope } from "@/lib/access/staff-scope";
import { localeHref } from "@/lib/i18n/locale-routing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewStaffCampaignBannerPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const access = await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_CAMPAIGN_BANNERS],
  });
  // The banners are the whole store's: a staff member limited to vendors,
  // locations or regions has no part of them to be shown.
  if (hasStaffScope(access.staffScope)) {
    redirect(await localeHref(locale, "/forbidden"));
  }
  const canEdit = access.staffPermissions.includes(
    STAFF_PERMISSIONS.MANAGE_CAMPAIGN_BANNERS,
  );
  const scope = {
    apiBase: "/api/admin/campaign-banners",
    basePath: "/staff/campaign-banners",
    canEdit,
    vendor: false,
  };
  // Making one needs the manage grant.
  if (!canEdit) redirect(await localeHref(locale, "/forbidden"));

  return <CampaignBannerEditor scope={scope} />;
}
