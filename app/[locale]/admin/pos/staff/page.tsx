import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { redirect } from "next/navigation";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { canAccessPOS } from "@/lib/access/rbac";
import { localeHref } from "@/lib/i18n/locale-routing";
import { POSReports } from "@/components/pos/pos-reports";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminPosStaffPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session } = await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.MANAGE_POS],
  });

  await connectDB();
  const settings = await getSettings();
  if (!settings.pos?.enabled) {
    redirect(await localeHref(locale, "/admin"));
  }
  if (!(await canAccessPOS(session.user))) {
    redirect(await localeHref(locale, "/admin"));
  }

  // Till sales by cashier, counter and tender, and the drawers' counts.
  return <POSReports />;
}
