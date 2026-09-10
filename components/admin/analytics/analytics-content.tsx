"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiClient } from "@/lib/api/client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Users,
  Eye,
  MousePointerClick,
  Clock,
  TrendingDown,
  Globe,
  FileText,
  Monitor,
  Smartphone,
  Tablet,
  Map,
  ArrowUpRight,
  RefreshCcw,
  Settings,
  AlertCircle,
  BarChart3,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DateRangePicker,
  rangeLengthDays,
  startOfDay,
  type AppliedDateRange,
} from "@/components/ui/date-range-picker";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  DashboardStatsGrid,
  DashboardStatsGridSkeleton,
  type DashboardStatCardItem,
} from "@/components/admin/dashboard-stat-card";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PlausibleAggResult {
  visitors: { value: number };
  pageviews: { value: number };
  bounce_rate: { value: number };
  visit_duration: { value: number };
  visits: { value: number };
}

interface TimeseriesPoint {
  date: string;
  visitors: number;
  pageviews: number;
}

interface BreakdownRow {
  page?: string;
  source?: string;
  country?: string;
  browser?: string;
  os?: string;
  device?: string;
  visitors: number;
  pageviews?: number;
}

type Period = "day" | "7d" | "30d" | "month" | "6mo" | "12mo" | "custom";
type DeviceTab = "browser" | "os" | "size";

const PERIOD_OPTIONS: { value: Exclude<Period, "custom"> }[] = [
  { value: "day" },
  { value: "7d" },
  { value: "30d" },
  { value: "month" },
  { value: "6mo" },
  { value: "12mo" },
];

const VISITORS_CHART_COLOR = "var(--chart-1)";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(
  seconds: number,
  t: ReturnType<typeof useTranslations>,
): string {
  if (!seconds) return `0${t("admin.analyticsPage.units.second")}`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0
    ? `${m}${t("admin.analyticsPage.units.minute")} ${s}${t("admin.analyticsPage.units.second")}`
    : `${s}${t("admin.analyticsPage.units.second")}`;
}

function formatNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n || 0);
}

function formatAxisNumber(n: number): string {
  if (Math.abs(n) >= 1000) {
    const value = n / 1000;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}k`;
  }

  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function getNiceChartMax(maxValue: number): number {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 100;

  const roughStep = maxValue / 5;
  const base = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / base;
  const step =
    normalized <= 1
      ? base
      : normalized <= 2
        ? base * 2
        : normalized <= 5
          ? base * 5
          : base * 10;

  return step * 5;
}

function getChartTicks(maxValue: number): number[] {
  const step = maxValue / 5;
  return Array.from({ length: 6 }, (_, index) => index * step);
}

function parseAnalyticsDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatChartDate(
  date: Date,
  locale: string,
  includeYear = true,
): string {
  const day = date.getDate();
  const month = new Intl.DateTimeFormat(locale, { month: "short" }).format(
    date,
  );
  return includeYear
    ? `${day} ${month}, ${date.getFullYear()}`
    : `${day} ${month}`;
}

function getFallbackDateRange(
  period: Exclude<Period, "custom">,
): AppliedDateRange {
  const to = startOfDay(new Date());
  const from = new Date(to);

  if (period === "day") {
    return { from, to };
  }

  if (period === "7d") {
    from.setDate(to.getDate() - 6);
    return { from, to };
  }

  if (period === "30d") {
    from.setDate(to.getDate() - 29);
    return { from, to };
  }

  if (period === "month") {
    from.setDate(1);
    return { from, to };
  }

  from.setDate(1);
  from.setMonth(to.getMonth() - (period === "6mo" ? 5 : 11));
  return { from, to };
}

function formatDateParam(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Analytics collapses a single-day range to one date, unlike the shared default. */
function formatAnalyticsRangeLabel(
  range: AppliedDateRange,
  locale: string,
): string {
  const { from, to } = range;

  if (from.toDateString() === to.toDateString()) {
    return formatChartDate(from, locale);
  }

  return `${formatChartDate(from, locale)} - ${formatChartDate(to, locale)}`;
}

function getChartTickPeriod(period: Period, range: AppliedDateRange): Period {
  if (period !== "custom") return period;
  const days = rangeLengthDays(range);
  if (days <= 1) return "day";
  if (days > 120) return "6mo";
  return "30d";
}

function formatChartTick(
  value: string,
  period: Period,
  locale: string,
  t: ReturnType<typeof useTranslations>,
): string {
  if (period === "day") {
    const hour = parseInt(value.slice(11, 13), 10);
    if (Number.isNaN(hour)) return value;

    const suffix =
      hour >= 12
        ? t("admin.analyticsPage.time.pm")
        : t("admin.analyticsPage.time.am");
    const h = hour % 12 || 12;
    return `${h}${suffix}`;
  }

  const date = parseAnalyticsDate(value);
  if (!date) return value;

  if (period === "6mo" || period === "12mo") {
    return new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
  }

  return formatChartDate(date, locale, false);
}

function getPeriodLabel(
  value: Period,
  t: ReturnType<typeof useTranslations>,
): string {
  if (value === "custom") {
    return t("admin.analyticsPage.periods.custom");
  }

  if (value === "day") {
    return t("admin.analyticsPage.periods.day");
  }

  if (value === "7d") {
    return t("admin.analyticsPage.periods.7d");
  }

  if (value === "30d") {
    return t("admin.analyticsPage.periods.30d");
  }

  if (value === "month") {
    return t("admin.analyticsPage.periods.month");
  }

  if (value === "6mo") {
    return t("admin.analyticsPage.periods.6mo");
  }

  return t("admin.analyticsPage.periods.12mo");
}

function tFallback(
  t: ReturnType<typeof useTranslations>,
  key: string,
  defaultMessage: string,
): string {
  const label = t(key, { defaultMessage });
  return label === key ? defaultMessage : label;
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return "🌐";
  return code
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
    .join("");
}

// ─── Breakdown Table ──────────────────────────────────────────────────────────

function BreakdownTable({
  rows,
  labelKey,
  labelRender,
  loading,
  emptyText = "No data",
  labelTitle = "Source",
  valueTitle = "Visitors",
  noneLabel = "(none)",
  locale = "en",
}: {
  rows: BreakdownRow[];
  labelKey: keyof BreakdownRow;
  labelRender?: (row: BreakdownRow, index: number) => React.ReactNode;
  loading?: boolean;
  emptyText?: string;
  labelTitle?: string;
  valueTitle?: string;
  noneLabel?: string;
  locale?: string;
}) {
  if (loading) {
    return (
      <div className="space-y-3 pt-1">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <div
              className="h-4 rounded bg-muted animate-pulse"
              style={{ width: `${70 - i * 10}%` }}
            />
            <div className="h-4 w-8 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        {emptyText}
      </p>
    );
  }

  const maxVal = rows[0]?.visitors ?? 1;

  return (
    <div>
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-wider pb-2 mb-1 border-b">
        <span>{labelTitle}</span>
        <span>{valueTitle}</span>
      </div>
      {rows.map((row, i) => {
        const pct = maxVal > 0 ? (row.visitors / maxVal) * 100 : 0;
        return (
          <div key={i} className="relative py-1.5">
            <div
              className="absolute inset-y-0.5 left-0 rounded bg-primary/8 dark:bg-primary/12"
              style={{ width: `${pct}%` }}
            />
            <div className="relative flex items-center justify-between gap-2 px-1.5">
              <span className="text-sm truncate max-w-[70%]">
                {labelRender
                  ? labelRender(row, i)
                  : (row[labelKey] as string) || noneLabel}
              </span>
              <span className="text-sm font-semibold tabular-nums shrink-0">
                {formatNumber(row.visitors, locale)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Not Configured ───────────────────────────────────────────────────────────

function NotConfigured({
  locale,
  area,
  t,
}: {
  locale: string;
  area: "admin" | "staff";
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card className="!rounded-sm border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
          <BarChart3 className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">
            {t("admin.analyticsPage.notConfigured.title")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-sm">
            {t("admin.analyticsPage.notConfigured.description")}
          </p>
        </div>
        {area === "admin" ? (
          <Link href={`/${locale}/admin/settings?section=analytics`}>
            <Button variant="outline" className="gap-2">
              <Settings className="h-4 w-4" />
              {t("admin.analyticsPage.notConfigured.cta")}
            </Button>
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
  period,
  locale,
  t,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
  period: Period;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!active || !payload?.length) return null;

  let formattedLabel = label || "";
  if (typeof label === "string") {
    if (period === "day") {
      const hour = parseInt(label.slice(11, 13), 10);
      const suffix =
        hour >= 12
          ? t("admin.analyticsPage.time.pm")
          : t("admin.analyticsPage.time.am");
      const h = hour % 12 || 12;
      formattedLabel = `${h}:00 ${suffix}`;
    } else {
      formattedLabel = new Date(label).toLocaleDateString(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }
  }

  return (
    <div className="bg-popover border rounded-sm shadow-md px-3 py-2.5 text-sm">
      <p className="text-xs text-muted-foreground mb-1.5">{formattedLabel}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-xs text-muted-foreground">{entry.name}</span>
          </div>
          <span className="text-xs font-semibold tabular-nums">
            {formatNumber(entry.value, locale)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function AnalyticsSkeleton() {
  return (
    <>
      {/* Stat Cards */}
      <DashboardStatsGridSkeleton items={6} />

      {/* Chart */}
      <Card className="!rounded-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <div className="h-5 w-36 rounded bg-muted animate-pulse" />
              <div className="h-3.5 w-48 rounded bg-muted animate-pulse" />
            </div>
            <div className="h-8 w-16 rounded-lg bg-muted animate-pulse" />
          </div>
          <div className="flex items-center gap-4 mt-1">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-muted animate-pulse" />
              <div className="h-3 w-12 rounded bg-muted animate-pulse" />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-muted animate-pulse" />
              <div className="h-3 w-14 rounded bg-muted animate-pulse" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-56 w-full rounded bg-muted/50 animate-pulse" />
        </CardContent>
      </Card>

      {/* Breakdown grids */}
      {[0, 1].map((g) => (
        <div key={g} className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((c) => (
            <Card key={c} className="!rounded-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                  {g === 1 && c === 1 && (
                    <div className="h-7 w-36 rounded-lg bg-muted animate-pulse" />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 pt-1">
                  {[70, 55, 40, 30, 20].map((w, j) => (
                    <div key={j} className="flex items-center justify-between">
                      <div
                        className="h-4 rounded bg-muted animate-pulse"
                        style={{ width: `${w}%` }}
                      />
                      <div className="h-4 w-8 rounded bg-muted animate-pulse" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ))}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t">
        <div className="h-3 w-44 rounded bg-muted animate-pulse" />
        <div className="h-3 w-36 rounded bg-muted animate-pulse" />
      </div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AdminAnalyticsContent({
  area = "admin",
}: {
  area?: "admin" | "staff";
}) {
  const t = useTranslations();
  const localeFromIntl = useLocale();
  const params = useParams<{ locale: string }>();
  const locale = params.locale || localeFromIntl || "en";

  const [period, setPeriod] = useState<Period>("30d");
  const [dateRange, setDateRange] = useState<AppliedDateRange>(() =>
    getFallbackDateRange("30d"),
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [deviceTab, setDeviceTab] = useState<DeviceTab>("browser");

  const [realtimeVisitors, setRealtimeVisitors] = useState<number | null>(null);
  const [aggregate, setAggregate] = useState<PlausibleAggResult | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [topPages, setTopPages] = useState<BreakdownRow[]>([]);
  const [topSources, setTopSources] = useState<BreakdownRow[]>([]);
  const [countries, setCountries] = useState<BreakdownRow[]>([]);
  const [browsers, setBrowsers] = useState<BreakdownRow[]>([]);
  const [osData, setOsData] = useState<BreakdownRow[]>([]);
  const [devicesData, setDevicesData] = useState<BreakdownRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const analyticsParams = new URLSearchParams({ period });
        if (period === "custom") {
          analyticsParams.set("from", formatDateParam(dateRange.from));
          analyticsParams.set("to", formatDateParam(dateRange.to));
        }
        const analyticsQuery = analyticsParams.toString();
        type PlausiblePayload = {
          configured?: boolean;
          // Same untyped contract the raw res.json() call had before.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data?: { results?: any; visitors?: number };
        };
        const [
          aggData,
          tsData,
          pagesData,
          sourcesData,
          countriesData,
          browsersData,
          osData_,
          devicesData_,
          rtData,
        ] = await Promise.all([
          apiClient.get<PlausiblePayload>(
            `/api/admin/analytics/plausible?metric=aggregate&${analyticsQuery}`,
          ),
          apiClient.get<PlausiblePayload>(
            `/api/admin/analytics/plausible?metric=timeseries&${analyticsQuery}`,
          ),
          apiClient.get<PlausiblePayload>(
            `/api/admin/analytics/plausible?metric=pages&${analyticsQuery}`,
          ),
          apiClient.get<PlausiblePayload>(
            `/api/admin/analytics/plausible?metric=sources&${analyticsQuery}`,
          ),
          apiClient.get<PlausiblePayload>(
            `/api/admin/analytics/plausible?metric=countries&${analyticsQuery}`,
          ),
          apiClient.get<PlausiblePayload>(
            `/api/admin/analytics/plausible?metric=browsers&${analyticsQuery}`,
          ),
          apiClient.get<PlausiblePayload>(
            `/api/admin/analytics/plausible?metric=os&${analyticsQuery}`,
          ),
          apiClient.get<PlausiblePayload>(
            `/api/admin/analytics/plausible?metric=devices&${analyticsQuery}`,
          ),
          apiClient.get<PlausiblePayload>(
            `/api/admin/analytics/plausible?metric=realtime`,
          ),
        ]);

        const isConfigured = aggData?.configured !== false;
        setConfigured(isConfigured);

        if (isConfigured) {
          if (aggData?.data?.results) setAggregate(aggData.data.results);
          if (tsData?.data?.results) setTimeseries(tsData.data.results);
          if (pagesData?.data?.results) setTopPages(pagesData.data.results);
          if (sourcesData?.data?.results)
            setTopSources(sourcesData.data.results);
          if (countriesData?.data?.results)
            setCountries(countriesData.data.results);
          if (browsersData?.data?.results)
            setBrowsers(browsersData.data.results);
          if (osData_?.data?.results) setOsData(osData_.data.results);
          if (devicesData_?.data?.results)
            setDevicesData(devicesData_.data.results);
          if (typeof rtData?.data?.visitors === "number")
            setRealtimeVisitors(rtData.data.visitors);
        }
      } catch {
        setError("loadFailed");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [dateRange, period],
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      void fetchAll();
    }, 0);

    return () => window.clearTimeout(id);
  }, [fetchAll]);

  // Realtime ping every 30s
  useEffect(() => {
    if (!configured) return;
    const id = setInterval(async () => {
      try {
        const d = await apiClient.get<{
          data?: { visitors?: number };
        }>("/api/admin/analytics/plausible?metric=realtime");
        if (typeof d?.data?.visitors === "number")
          setRealtimeVisitors(d.data.visitors);
      } catch {}
    }, 30_000);
    return () => clearInterval(id);
  }, [configured]);

  const deviceRows =
    deviceTab === "browser"
      ? browsers
      : deviceTab === "os"
        ? osData
        : devicesData;
  const handlePeriodChange = (nextPeriod: Exclude<Period, "custom">) => {
    setPeriod(nextPeriod);
    setDateRange(getFallbackDateRange(nextPeriod));
  };
  const handleDateRangeApply = (range: AppliedDateRange) => {
    setPeriod("custom");
    setDateRange(range);
  };
  const trafficStats: DashboardStatCardItem[] = [
    {
      id: "online-now",
      label: t("admin.analyticsPage.cards.onlineNow"),
      icon: <Activity />,
      value:
        realtimeVisitors !== null
          ? formatNumber(realtimeVisitors, locale)
          : "—",
    },
    {
      id: "unique-visitors",
      label: t("admin.analyticsPage.cards.uniqueVisitors"),
      icon: <Users />,
      value: aggregate ? formatNumber(aggregate.visitors.value, locale) : "—",
    },
    {
      id: "total-pageviews",
      label: t("admin.analyticsPage.cards.totalPageviews"),
      icon: <Eye />,
      value: aggregate ? formatNumber(aggregate.pageviews.value, locale) : "—",
    },
    {
      id: "total-visits",
      label: t("admin.analyticsPage.cards.totalVisits"),
      icon: <MousePointerClick />,
      value: aggregate ? formatNumber(aggregate.visits.value, locale) : "—",
    },
    {
      id: "bounce-rate",
      label: t("admin.analyticsPage.cards.bounceRate"),
      icon: <TrendingDown />,
      value: aggregate ? `${aggregate.bounce_rate.value}%` : "—",
    },
    {
      id: "avg-duration",
      label: t("admin.analyticsPage.cards.avgDuration"),
      icon: <Clock />,
      value: aggregate
        ? formatDuration(aggregate.visit_duration.value, t)
        : "—",
    },
  ];
  const chartMaxValue = timeseries.reduce(
    (max, point) => Math.max(max, point.visitors || 0, point.pageviews || 0),
    0,
  );
  const chartYAxisMax = getNiceChartMax(chartMaxValue);
  const chartYAxisTicks = getChartTicks(chartYAxisMax);
  const chartTickPeriod = getChartTickPeriod(period, dateRange);
  const visitorsLabel = t("admin.analyticsPage.visitors");
  const pageviewsLabel = t("admin.analyticsPage.pageviews");

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("admin.sidebar.analytics")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("admin.analyticsPage.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {realtimeVisitors !== null && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-xs font-medium text-green-700 dark:text-green-400">
                {`${new Intl.NumberFormat(locale).format(realtimeVisitors)} ${t("admin.analyticsPage.onlineNow")}`}
              </span>
            </div>
          )}
          <div className="flex items-center rounded-lg border bg-muted/30 p-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handlePeriodChange(opt.value)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  period === opt.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {getPeriodLabel(opt.value, t)}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchAll(true)}
            disabled={refreshing}
            className="h-8 w-8"
          >
            <RefreshCcw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-4 py-2.5 rounded-lg border border-destructive/20">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error === "loadFailed"
            ? t("admin.analyticsPage.errors.loadFailed")
            : error}
        </div>
      )}

      {/* ── Plausible Section ── */}
      {loading && configured === null ? (
        <AnalyticsSkeleton />
      ) : configured === false ? (
        <NotConfigured locale={locale} area={area} t={t} />
      ) : (
        <>
          {/* ── Traffic Tiles ── */}
          {loading ? (
            <DashboardStatsGridSkeleton items={6} />
          ) : (
            <DashboardStatsGrid stats={trafficStats} />
          )}

          {/* ── Timeseries Chart ── */}
          <Card
            aria-label={t("admin.analyticsPage.chart.title")}
            className="overflow-hidden !rounded-sm border-[#dfe5ee] bg-card py-0 shadow-sm dark:border-border"
          >
            <CardContent className="p-5 sm:p-5">
              <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] font-medium text-[#344054] dark:text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-[2px]"
                      style={{ backgroundColor: VISITORS_CHART_COLOR }}
                    />
                    <span>{visitorsLabel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-[2px]"
                      style={{ backgroundColor: "#ff5b00" }}
                    />
                    <span>{pageviewsLabel}</span>
                  </div>
                </div>

                <DateRangePicker
                  value={dateRange}
                  onApply={handleDateRangeApply}
                  locale={locale}
                  cancelLabel={tFallback(t, "common.cancel", "Cancel")}
                  applyLabel={tFallback(t, "common.apply", "Apply")}
                  align="start"
                  formatLabel={formatAnalyticsRangeLabel}
                  triggerClassName="h-9 justify-start gap-1.5 rounded-sm border-[#dfe5ee] bg-card px-3 text-[#172033] shadow-xs hover:bg-card hover:text-[#172033] sm:w-55 dark:border-border dark:text-foreground dark:hover:bg-card dark:hover:text-foreground"
                  contentClassName="!rounded-sm border-[#dfe5ee] bg-card shadow-[0_14px_32px_rgba(16,24,40,0.14)] dark:border-border"
                  iconClassName="size-3.5 text-[#172033] dark:text-muted-foreground"
                />
              </div>

              {loading ? (
                <div className="h-[300px] w-full rounded bg-muted/50 animate-pulse" />
              ) : timeseries.length === 0 ? (
                <div className="flex h-[300px] items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    {t("admin.analyticsPage.empty.timeseries")}
                  </p>
                </div>
              ) : (
                <div className="h-[292px] w-full sm:h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={timeseries}
                      margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="analyticsVisitors"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={VISITORS_CHART_COLOR}
                            stopOpacity={0.28}
                          />
                          <stop
                            offset="100%"
                            stopColor={VISITORS_CHART_COLOR}
                            stopOpacity={0}
                          />
                        </linearGradient>
                        <linearGradient
                          id="analyticsPageviews"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#ff5b00"
                            stopOpacity={0.23}
                          />
                          <stop
                            offset="100%"
                            stopColor="#ff5b00"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="#e3e8f0"
                        strokeDasharray="2 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        interval="preserveStartEnd"
                        minTickGap={24}
                        tick={{
                          fontSize: 13,
                          fontWeight: 500,
                          fill: "#8c99ad",
                        }}
                        tickLine={false}
                        tickMargin={14}
                        tickFormatter={(value: string) =>
                          formatChartTick(value, chartTickPeriod, locale, t)
                        }
                      />
                      <YAxis
                        axisLine={false}
                        domain={[0, chartYAxisMax]}
                        ticks={chartYAxisTicks}
                        tick={{
                          fontSize: 13,
                          fontWeight: 500,
                          fill: "#8c99ad",
                        }}
                        tickLine={false}
                        tickMargin={16}
                        tickFormatter={(value) =>
                          formatAxisNumber(Number(value))
                        }
                        width={48}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            period={chartTickPeriod}
                            locale={locale}
                            t={t}
                          />
                        }
                        cursor={{
                          stroke: "#98a2b3",
                          strokeDasharray: "3 3",
                          strokeWidth: 1,
                        }}
                        wrapperStyle={{ outline: "none" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="pageviews"
                        stroke="#ff5b00"
                        strokeWidth={2}
                        fill="url(#analyticsPageviews)"
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0, fill: "#ff5b00" }}
                        name={pageviewsLabel}
                        connectNulls
                      />
                      <Area
                        type="monotone"
                        dataKey="visitors"
                        stroke={VISITORS_CHART_COLOR}
                        strokeWidth={2}
                        fill="url(#analyticsVisitors)"
                        dot={false}
                        activeDot={{
                          r: 4,
                          strokeWidth: 0,
                          fill: VISITORS_CHART_COLOR,
                        }}
                        name={visitorsLabel}
                        connectNulls
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Top Sources + Top Pages ── */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="!rounded-sm">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />{" "}
                  {t("admin.analyticsPage.topSources")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  rows={topSources}
                  labelKey="source"
                  labelTitle={t("admin.analyticsPage.columns.source")}
                  valueTitle={t("admin.analyticsPage.columns.visitors")}
                  noneLabel={t("admin.analyticsPage.none")}
                  locale={locale}
                  labelRender={(row) => (
                    <span className="flex items-center gap-2">
                      {row.source && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`https://icons.duckduckgo.com/ip3/${row.source}.ico`}
                          alt=""
                          className="h-4 w-4 rounded-sm object-contain shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                      )}
                      {row.source || t("admin.analyticsPage.directNone")}
                    </span>
                  )}
                  loading={loading}
                  emptyText={t("admin.analyticsPage.empty.sources")}
                />
              </CardContent>
            </Card>

            <Card className="!rounded-sm">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />{" "}
                  {t("admin.analyticsPage.topPages")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  rows={topPages}
                  labelKey="page"
                  labelTitle={t("admin.analyticsPage.columns.page")}
                  valueTitle={t("admin.analyticsPage.columns.visitors")}
                  noneLabel={t("admin.analyticsPage.none")}
                  locale={locale}
                  loading={loading}
                  emptyText={t("admin.analyticsPage.empty.pages")}
                />
              </CardContent>
            </Card>
          </div>

          {/* ── Countries + Devices ── */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="!rounded-sm">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Map className="h-4 w-4 text-muted-foreground" />{" "}
                  {t("admin.analyticsPage.countries")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  rows={countries}
                  labelKey="country"
                  labelTitle={t("admin.analyticsPage.columns.country")}
                  valueTitle={t("admin.analyticsPage.columns.visitors")}
                  noneLabel={t("admin.analyticsPage.none")}
                  locale={locale}
                  labelRender={(row) => (
                    <span className="flex items-center gap-2">
                      <span className="text-base leading-none">
                        {countryFlag(row.country || "")}
                      </span>
                      {row.country || t("admin.analyticsPage.unknown")}
                    </span>
                  )}
                  loading={loading}
                  emptyText={t("admin.analyticsPage.empty.countries")}
                />
              </CardContent>
            </Card>

            <Card className="!rounded-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-muted-foreground" />{" "}
                    {t("admin.analyticsPage.devices")}
                  </CardTitle>
                  <Tabs
                    value={deviceTab}
                    onValueChange={(v) => setDeviceTab(v as DeviceTab)}
                  >
                    <TabsList className="h-7">
                      <TabsTrigger
                        value="browser"
                        className="text-xs px-2.5 h-6"
                      >
                        {t("admin.analyticsPage.tabs.browser")}
                      </TabsTrigger>
                      <TabsTrigger value="os" className="text-xs px-2.5 h-6">
                        {t("admin.analyticsPage.tabs.os")}
                      </TabsTrigger>
                      <TabsTrigger value="size" className="text-xs px-2.5 h-6">
                        {t("admin.analyticsPage.tabs.size")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent>
                <BreakdownTable
                  rows={deviceRows}
                  labelKey={
                    deviceTab === "browser"
                      ? "browser"
                      : deviceTab === "os"
                        ? "os"
                        : "device"
                  }
                  labelRender={(row) => {
                    const label =
                      deviceTab === "browser"
                        ? row.browser
                        : deviceTab === "os"
                          ? row.os
                          : row.device;
                    const low = (label || "").toLowerCase();
                    const icon =
                      low.includes("mobile") ||
                      low.includes("phone") ||
                      low.includes("android") ||
                      low.includes("ios") ? (
                        <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : low.includes("tablet") ? (
                        <Tablet className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      );
                    return (
                      <span className="flex items-center gap-2">
                        {icon}
                        {label || t("admin.analyticsPage.unknown")}
                      </span>
                    );
                  }}
                  loading={loading}
                  labelTitle={t("admin.analyticsPage.columns.device")}
                  valueTitle={t("admin.analyticsPage.columns.visitors")}
                  noneLabel={t("admin.analyticsPage.none")}
                  locale={locale}
                  emptyText={t("admin.analyticsPage.empty.devices")}
                />
              </CardContent>
            </Card>
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              {t("admin.analyticsPage.poweredBy")}
            </p>
            <a
              href="https://plausible.io"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("admin.analyticsPage.openDashboard")}{" "}
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </>
      )}
    </div>
  );
}
