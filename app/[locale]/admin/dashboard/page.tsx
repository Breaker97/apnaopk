import { Suspense } from "react";
import { getSettings } from "@/models";
import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { DashboardHeader } from "@/components/admin/dashboard-header";
import { DashboardStatsSection } from "@/components/admin/dashboard-stats-section";
import { DashboardOrdersChart } from "@/components/admin/dashboard-orders-chart";
import { DashboardRecentOrders } from "@/components/admin/dashboard-recent-orders";
import { DashboardLatestProducts } from "@/components/admin/dashboard-latest-products";
import { DashboardVisitorsChart } from "@/components/admin/dashboard-visitors-chart";
import {
  LatestProductsSkeleton,
  OrdersChartSkeleton,
  RecentOrdersSkeleton,
  VisitorsChartSkeleton,
} from "@/components/admin/dashboard-skeleton";
import { DashboardPeriodPicker } from "@/components/admin/dashboard-period-picker";
import {
  resolveDashboardPeriod,
  toDayString,
  type DashboardPeriodSearch,
  type DashboardRange,
} from "@/lib/admin/dashboard-period";
import { after } from "next/server";
import { reportStaleCronJobs } from "@/lib/cron/health";
import {
  getDashboardStats,
  getLatestProducts,
  getOrderChartSeries,
  getRecentOrders,
  getVisitorsChartMetrics,
} from "@/lib/admin/dashboard-data";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<DashboardPeriodSearch>;
}

/**
 * Every section here owns its query and streams in on its own. The page used to
 * render a shell that then fetched `/api/admin/dashboard` from the browser: an
 * extra round trip behind hydration, and one payload gated on its slowest
 * member — the Plausible call — so a third-party hiccup blanked the whole page.
 * Rendering on the server removes the round trip; separate Suspense boundaries
 * mean the orders card no longer waits on analytics.
 */
export default async function AdminDashboardPage({
  params,
  searchParams,
}: PageProps) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  const period = resolveDashboardPeriod(search);
  setRequestLocale(locale);
  // A job that has stopped being scheduled cannot report itself, so the check
  // rides on the one page an admin reliably opens. `after` keeps it off the
  // render path entirely — the dashboard neither waits for it nor fails with it.
  after(() => reportStaleCronJobs());

  const [session, settings] = await Promise.all([
    requireAdminPageAccess(locale),
    getSettings(),
  ]);

  const userName =
    session.user.name?.split(" ")[0] || session.user.email?.split("@")[0] || "";
  const posEnabled = Boolean(settings.pos?.enabled);
  // Both period-driven sections remount on a change so their skeletons show;
  // without it a navigation keeps the old numbers on screen until the new ones
  // land, which reads as the filter doing nothing.
  const periodKey = `${period.key}:${search.from ?? ""}:${search.to ?? ""}`;
  const periodProps = {
    key: period.key,
    from: period.range ? toDayString(period.range.from) : "",
    to: period.range ? toDayString(period.range.to) : "",
  };

  return (
    <div className="space-y-4 pb-6 text-foreground">
      <DashboardHeader
        userName={userName}
        period={periodProps}
        filter={
          <DashboardPeriodPicker
            period={periodProps.key}
            from={periodProps.from}
            to={periodProps.to}
          />
        }
      />

      <Suspense
        key={`stats:${periodKey}`}
        fallback={
          <DashboardStatsSection
            stats={null}
            posEnabled={posEnabled}
            ranged={Boolean(period.range)}
          />
        }
      >
        <StatsSection posEnabled={posEnabled} range={period.range} />
      </Suspense>

      <Suspense key={`chart:${periodKey}`} fallback={<OrdersChartSkeleton />}>
        <OrdersChartSection range={period.range} />
      </Suspense>

      <Suspense fallback={<RecentOrdersSkeleton />}>
        <RecentOrdersSection />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Suspense fallback={<LatestProductsSkeleton />}>
          <LatestProductsSection />
        </Suspense>
        <Suspense fallback={<VisitorsChartSkeleton />}>
          <VisitorsChartSection />
        </Suspense>
      </div>
    </div>
  );
}

async function StatsSection({
  posEnabled,
  range,
}: {
  posEnabled: boolean;
  range: DashboardRange | null;
}) {
  const stats = await getDashboardStats(range);
  return (
    <DashboardStatsSection
      stats={stats}
      posEnabled={posEnabled}
      ranged={Boolean(range)}
    />
  );
}

async function OrdersChartSection({ range }: { range: DashboardRange | null }) {
  // Shares the stats aggregation through React's request cache, so the two
  // boundaries cost one query between them.
  const series = await getOrderChartSeries(range);
  return <DashboardOrdersChart series={series} />;
}

async function RecentOrdersSection() {
  const orders = await getRecentOrders();
  return <DashboardRecentOrders orders={orders} />;
}

async function LatestProductsSection() {
  const products = await getLatestProducts();
  return <DashboardLatestProducts products={products} />;
}

async function VisitorsChartSection() {
  const metrics = await getVisitorsChartMetrics();
  return <DashboardVisitorsChart metrics={metrics} />;
}
