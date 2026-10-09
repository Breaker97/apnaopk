import { setRequestLocale } from "next-intl/server";
import { AdminAnalyticsContent } from "@/components/admin/analytics/analytics-content";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { hasStaffScope } from "@/lib/access/staff-scope";
import type { DashboardPeriodSearch } from "@/lib/admin/dashboard-period";
import { loadTrafficOverview } from "@/lib/analytics/plausible";
import {
  resolveTrafficSelection,
  trafficQueryFor,
} from "@/lib/analytics/traffic-overview";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<DashboardPeriodSearch>;
}

export default async function StaffAnalyticsPage({
  params,
  searchParams,
}: PageProps) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);

  const { staffScope } = await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ANALYTICS],
  });

  const selection = resolveTrafficSelection(search);

  // Started, not awaited: Plausible answers while the page streams and
  // hydrates instead of after. Scoped staff get none, as the API refuses them.
  const initialOverview = hasStaffScope(staffScope)
    ? undefined
    : loadTrafficOverview(trafficQueryFor(selection));

  return (
    <AdminAnalyticsContent
      area="staff"
      // A new period remounts the page so it reads its own head start.
      key={`${selection.key}:${selection.from}:${selection.to}`}
      selection={selection}
      initialOverview={initialOverview}
    />
  );
}
