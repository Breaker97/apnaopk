import { connectDB } from "@/lib/db";
import { canAccessPOS } from "@/lib/access/rbac";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { POSPageShell } from "@/components/pos/pos-page-shell";
import { buildPOSSettings } from "@/lib/pos/build-pos-settings";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminPosPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session } = await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.ACCESS_POS],
  });

  await connectDB();
  const settings = await getSettings();
  if (!settings.pos?.enabled) {
    redirect(`/${locale}/admin`);
  }
  if (!(await canAccessPOS(session.user))) {
    redirect(`/${locale}/admin`);
  }

  // The shell streams a skeleton while it resolves the product list, so the
  // page never waits on the catalogue query before painting.
  return (
    <POSPageShell settings={buildPOSSettings(settings)} user={session.user} />
  );
}
