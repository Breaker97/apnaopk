import { setRequestLocale } from "next-intl/server";
import { SearchInsights } from "@/components/admin/analytics/search-insights";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function StaffSearchInsightsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ANALYTICS],
  });

  return (
    <SearchInsights
      locale={locale}
      basePath="/staff/analytics/search"
      searchParams={await searchParams}
    />
  );
}
