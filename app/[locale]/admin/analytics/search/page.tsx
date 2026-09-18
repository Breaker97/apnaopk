import { setRequestLocale } from "next-intl/server";
import { SearchInsights } from "@/components/admin/analytics/search-insights";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminSearchInsightsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ANALYTICS],
  });

  return (
    <SearchInsights
      locale={locale}
      basePath="/admin/analytics/search"
      searchParams={await searchParams}
    />
  );
}
