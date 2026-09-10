import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { redirect } from "next/navigation";
import { LocationsContent } from "@/components/pos/locations-content";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { canAccessPOS } from "@/lib/access/rbac";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function StaffPosLocationsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session } = await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.MANAGE_POS],
  });

  await connectDB();
  const settings = await getSettings();
  if (!settings.pos?.enabled) {
    redirect(`/${locale}/staff/dashboard`);
  }
  if (!(await canAccessPOS(session.user))) {
    redirect(`/${locale}/staff/dashboard`);
  }

  return <LocationsContent />;
}

