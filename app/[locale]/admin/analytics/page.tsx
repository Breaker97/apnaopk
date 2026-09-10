import { setRequestLocale } from "next-intl/server";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { AdminAnalyticsContent } from "@/components/admin/analytics/analytics-content";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminAnalyticsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ANALYTICS],
  });

  return <AdminAnalyticsContent />;
}
