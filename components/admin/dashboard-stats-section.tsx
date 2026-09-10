"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BadgeDollarSign,
  Globe,
  RefreshCcw,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCurrency } from "@/providers/currency-provider";
import {
  DashboardStatCard,
  statsGridColumnsFor,
  type DashboardStatTrendConfig,
} from "@/components/admin/dashboard-stat-card";
import type {
  DashboardStatMetric,
  DashboardStats,
} from "@/lib/admin/dashboard-types";

interface StatCardDefinition {
  id: string;
  icon: React.ReactNode;
  label: string;
  /** Excluded from the primary set when false; fallback cards keep the grid at six cards. */
  visible?: boolean;
  getMetric: (stats: DashboardStats) => DashboardStatMetric;
  formatValue: (metric: DashboardStatMetric) => string;
  formatSubLabel: (metric: DashboardStatMetric) => React.ReactNode;
}

interface DashboardStatsSectionProps {
  /** Real metrics once loaded; null renders the cards in their loading state. */
  stats: DashboardStats | null;
  /** When false, the In-store sales card is replaced so the dashboard still renders six cards. */
  posEnabled: boolean;
}

function buildStatTrend(
  metric: DashboardStatMetric,
): DashboardStatTrendConfig | undefined {
  if (metric.value === null) return undefined;
  const formatted =
    metric.value >= 10 ? metric.value.toFixed(0) : metric.value.toFixed(1);
  return { value: `${formatted}%`, direction: metric.direction };
}

/**
 * The six dashboard metric cards. Labels and icons render instantly; only the
 * value, sub-label, and trend swap from skeleton to real data. The same
 * component renders the Suspense fallback with `stats={null}`, so nothing in
 * the grid shifts when the numbers stream in.
 */
export function DashboardStatsSection({
  stats,
  posEnabled,
}: DashboardStatsSectionProps) {
  const t = useTranslations();
  const intlLocale = useLocale();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale || intlLocale || "en";
  const { formatPrice } = useCurrency();

  const numberFormatter = new Intl.NumberFormat(locale);
  const compactFormatter = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const ordersLabel = t("admin.dashboardPage.orders");
  const casesLabel = t("admin.dashboardPage.cases");

  const definitions: StatCardDefinition[] = [
    {
      id: "in-store-sales",
      icon: <Store />,
      visible: posEnabled,
      label: t("admin.dashboardPage.stats.inStoreSales"),
      getMetric: (s) => s.inStoreSales,
      formatValue: (m) => formatPrice(m.amount),
      formatSubLabel: (m) =>
        `${compactFormatter.format(m.count)} ${ordersLabel}`,
    },
    {
      id: "website-sales",
      icon: <Globe />,
      label: t("admin.dashboardPage.stats.websiteSales"),
      getMetric: (s) => s.websiteSales,
      formatValue: (m) => formatPrice(m.amount),
      formatSubLabel: (m) =>
        `${compactFormatter.format(m.count)} ${ordersLabel}`,
    },
    {
      id: "total-orders",
      icon: <ShoppingBag />,
      label: t("admin.dashboardPage.stats.totalOrders"),
      getMetric: (s) => s.totalOrders,
      formatValue: (m) => numberFormatter.format(m.amount),
      formatSubLabel: (m) =>
        `${compactFormatter.format(m.count)} ${ordersLabel}`,
    },
    {
      id: "discount",
      icon: <BadgeDollarSign />,
      label: t("admin.dashboardPage.stats.discount"),
      getMetric: (s) => s.discount,
      formatValue: (m) => formatPrice(m.amount),
      formatSubLabel: (m) =>
        `${compactFormatter.format(m.count)} ${ordersLabel}`,
    },
    {
      id: "customers",
      icon: <Users />,
      label: t("admin.dashboardPage.stats.customers"),
      getMetric: (s) => s.customers,
      formatValue: (m) => numberFormatter.format(m.amount),
      formatSubLabel: (m) =>
        t("admin.dashboardPage.stats.newThisMonth", {
          count: compactFormatter.format(m.count),
        }),
    },
    {
      id: "refunds",
      icon: <RefreshCcw />,
      label: t("admin.dashboardPage.stats.refunds"),
      getMetric: (s) => s.refunds,
      formatValue: (m) => formatPrice(m.amount),
      formatSubLabel: (m) =>
        `${compactFormatter.format(m.count)} ${casesLabel}`,
    },
  ];

  // Stand-ins that keep the grid at six cards when a primary card is hidden.
  const fallbackDefinitions: StatCardDefinition[] = [
    {
      id: "total-sales",
      icon: <BadgeDollarSign />,
      label: "Total sales",
      getMetric: (s) => ({
        amount: s.inStoreSales.amount + s.websiteSales.amount,
        count: s.inStoreSales.count + s.websiteSales.count,
        value: null,
        direction: "neutral",
      }),
      formatValue: (m) => formatPrice(m.amount),
      formatSubLabel: (m) =>
        `${compactFormatter.format(m.count)} ${ordersLabel}`,
    },
    {
      id: "average-order-value",
      icon: <ShoppingBag />,
      label: "Average order value",
      getMetric: (s) => {
        const totalSales = s.inStoreSales.amount + s.websiteSales.amount;
        const orderCount = s.totalOrders.amount;
        return {
          amount: orderCount > 0 ? totalSales / orderCount : 0,
          count: orderCount,
          value: null,
          direction: "neutral",
        };
      },
      formatValue: (m) => formatPrice(m.amount),
      formatSubLabel: (m) =>
        `${compactFormatter.format(m.count)} ${ordersLabel}`,
    },
  ];

  const visibleDefinitions = definitions.filter(
    (definition) => definition.visible !== false,
  );

  for (const fallback of fallbackDefinitions) {
    if (visibleDefinitions.length >= 6) break;
    visibleDefinitions.push(fallback);
  }

  const cards = visibleDefinitions.slice(0, 6);

  return (
    <div className={`grid gap-3 ${statsGridColumnsFor(cards.length)}`}>
      {cards.map((definition) => {
        const metric = stats ? definition.getMetric(stats) : null;

        return (
          <DashboardStatCard
            key={definition.id}
            icon={definition.icon}
            label={definition.label}
            loading={!metric}
            value={metric ? definition.formatValue(metric) : null}
            subLabel={metric ? definition.formatSubLabel(metric) : undefined}
            trend={metric ? buildStatTrend(metric) : undefined}
          />
        );
      })}
    </div>
  );
}
