import { connectDB } from "@/lib/db";
import { canAccessPOS } from "@/lib/access/rbac";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { localeHref } from "@/lib/i18n/locale-routing";
import { POSReports } from "@/components/pos/pos-reports";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** A seller's till reports: their own registers' sales and drawers. */
export default async function VendorPosReportsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session } = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.ACCESS_POS],
  });

  await connectDB();
  const settings = await getSettings();
  if (!settings.pos?.enabled) {
    redirect(await localeHref(locale, "/vendor/dashboard"));
  }
  if (!(await canAccessPOS(session.user))) {
    redirect(await localeHref(locale, "/vendor/dashboard"));
  }

  return <POSReports />;
}
