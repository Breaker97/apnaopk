import { setRequestLocale } from "next-intl/server";
import { AdminAnalyticsContent } from "@/components/admin/analytics/analytics-content";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function StaffAnalyticsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ANALYTICS],
  });

  return <AdminAnalyticsContent area="staff" />;
}
