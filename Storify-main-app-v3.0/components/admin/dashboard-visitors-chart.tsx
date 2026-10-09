"use client";

import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardStatTrend } from "@/components/admin/dashboard-stat-card";
import { getChartTicks, getNiceMax } from "@/lib/admin/dashboard-chart-scale";
import type { VisitorsChartMetrics } from "@/lib/admin/dashboard-types";

/** Empty frame drawn when Plausible is not connected, so the card keeps its shape. */
const PLACEHOLDER_DATA = Array.from({ length: 10 }, (_, index) => ({
  day: String(index + 1),
  current: 0,
  previous: 0,
}));
const PLACEHOLDER_TICKS = [0, 12.5, 25, 37.5, 50];
const PLACEHOLDER_DOMAIN: [number, number] = [0, 50];

function formatTrend(metrics: VisitorsChartMetrics) {
  const delta = metrics.currentTotal - metrics.previousTotal;
  const percent =
    metrics.previousTotal > 0
      ? (Math.abs(delta) / metrics.previousTotal) * 100
      : metrics.currentTotal > 0
        ? 100
        : 0;

  return {
    up: delta >= 0,
    label:
      percent === 0
        ? "0%"
        : `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`,
  };
}

/**
 * Month-to-date visitors from Plausible, compared with the same span of the
 * previous month. Renders an empty frame when analytics is not configured.
 */
export function DashboardVisitorsChart({
  metrics,
}: {
  metrics: VisitorsChartMetrics;
}) {
  const t = useTranslations();
  const intlLocale = useLocale();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale || intlLocale || "en";

  const numberFormatter = new Intl.NumberFormat(locale);
  const trend = formatTrend(metrics);
  const maxValue = getNiceMax(
    metrics.data.reduce(
      (max, point) => Math.max(max, point.current, point.previous),
      0,
    ),
  );

  const visitorsLabel = t("admin.analyticsPage.visitors");
  const pageviewsLabel = t("admin.analyticsPage.pageviews");
  const total = numberFormatter.format(metrics.currentTotal);

  const formatTooltipLabel = (label: unknown) => {
    if (typeof label !== "string") return String(label ?? "");

    if (/^\d{4}-\d{2}-\d{2}/.test(label)) {
      const date = new Date(`${label.slice(0, 10)}T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        return new Intl.DateTimeFormat(locale, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }).format(date);
      }
    }

    return label;
  };

  return (
    <section className="rounded-sm border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {t("admin.dashboardPage.totalVisitors")}
          </h2>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-2xl font-semibold leading-tight tracking-tight text-foreground tabular-nums">
              {total}
            </span>
            <DashboardStatTrend
              value={trend.label}
              direction={trend.up ? "up" : "down"}
            />
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          {total} {visitorsLabel}
        </span>
      </div>

      <div className="mt-4 h-[220px] sm:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={metrics.configured ? metrics.data : PLACEHOLDER_DATA}>
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="0"
            />
            <XAxis dataKey="day" hide />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              ticks={metrics.configured ? getChartTicks(maxValue) : PLACEHOLDER_TICKS}
              domain={metrics.configured ? [0, maxValue] : PLACEHOLDER_DOMAIN}
            />
            <Tooltip
              cursor={{
                stroke: "var(--border)",
                strokeDasharray: "3 3",
                strokeWidth: 1,
              }}
              wrapperStyle={{ outline: "none" }}
              contentStyle={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "var(--card)",
                color: "var(--foreground)",
              }}
              formatter={(value, name) => [
                numberFormatter.format(Number(value)),
                name,
              ]}
              labelFormatter={formatTooltipLabel}
            />
            <Line
              type="monotone"
              dataKey="current"
              stroke="var(--primary)"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: "var(--primary)" }}
              name={visitorsLabel}
            />
            <Line
              type="monotone"
              dataKey="previous"
              stroke="var(--muted-foreground)"
              strokeWidth={3}
              dot={false}
              activeDot={{
                r: 4,
                strokeWidth: 0,
                fill: "var(--muted-foreground)",
              }}
              name={pageviewsLabel}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-[2px] bg-blue-600" /> {visitorsLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-[2px] bg-muted-foreground/60" />{" "}
          {pageviewsLabel}
        </span>
      </div>
    </section>
  );
}
