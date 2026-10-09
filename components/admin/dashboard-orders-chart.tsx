"use client";

import Link from "@/components/language/link";
import * as React from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Blocks,
  ChevronRight,
  Megaphone,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrency } from "@/providers/currency-provider";
import {
  getChartTicks,
  getNiceCountMax,
  getNiceMax,
} from "@/lib/admin/dashboard-chart-scale";
import type {
  OrderChartGranularity,
  OrderChartSeries,
} from "@/lib/admin/dashboard-types";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

type OrdersChartView = "orders" | "sales";

interface ChartLink {
  href: string;
  labelKey: string;
}

interface ChartAreaLinks {
  /** The "Add activity" menu. */
  quickActions: ChartLink[];
  /** Where the highlights dialog sends the reader for more. */
  highlights: ChartLink[];
  /** The sales-data dialog's footer button. */
  report: ChartLink;
}

/** Locale-less; prefixed with the current locale when rendered. */
const AREA_LINKS: Record<"admin" | "vendor", ChartAreaLinks> = {
  admin: {
    quickActions: [
      { href: "/admin/products/new", labelKey: "admin.dashboardPage.addProduct" },
      { href: "/admin/categories/new", labelKey: "admin.dashboardPage.addCategory" },
      { href: "/admin/collections/new", labelKey: "admin.dashboardPage.addCollection" },
      { href: "/admin/customers/new", labelKey: "admin.dashboardPage.addCustomer" },
    ],
    highlights: [
      { href: "/admin/analytics", labelKey: "admin.sidebar.analytics" },
      { href: "/admin/orders", labelKey: "admin.sidebar.orders" },
    ],
    report: { href: "/admin/analytics", labelKey: "admin.sidebar.analytics" },
  },
  vendor: {
    // Vendors add categories and collections from their list pages; there is
    // no vendor analytics page, so the dialogs lead to the orders list.
    quickActions: [
      { href: "/vendor/products/new", labelKey: "admin.dashboardPage.addProduct" },
      { href: "/vendor/categories", labelKey: "admin.dashboardPage.addCategory" },
      { href: "/vendor/collections", labelKey: "admin.dashboardPage.addCollection" },
      { href: "/vendor/orders", labelKey: "admin.sidebar.orders" },
    ],
    highlights: [{ href: "/vendor/orders", labelKey: "admin.sidebar.orders" }],
    report: { href: "/vendor/orders", labelKey: "admin.sidebar.orders" },
  },
};

/** Axis tick and table-row formats per bucket size. Buckets are UTC, so are these. */
const BUCKET_FORMATS: Record<
  OrderChartGranularity,
  { axis: Intl.DateTimeFormatOptions; row: Intl.DateTimeFormatOptions }
> = {
  hour: {
    axis: { hour: "2-digit", minute: "2-digit" },
    row: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  },
  day: {
    axis: { day: "numeric", month: "short" },
    row: { day: "numeric", month: "short", year: "numeric" },
  },
  week: {
    axis: { day: "numeric", month: "short" },
    row: { day: "numeric", month: "short", year: "numeric" },
  },
  month: {
    axis: { month: "short" },
    row: { month: "short", year: "numeric" },
  },
  year: { axis: { year: "numeric" }, row: { year: "numeric" } },
};

const GRANULARITY_FALLBACK: Record<OrderChartGranularity, string> = {
  hour: "Hourly",
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};

interface DashboardOrdersChartProps {
  /**
   * The series for the dashboard's one period filter. The chart draws it as
   * given and shows no picker of its own — a second date control beside the
   * page's would let the cards and the chart describe two different periods at
   * once.
   */
  series: OrderChartSeries;
  area?: "admin" | "vendor";
}

/**
 * Orders/sales chart with its side panel and drill-down dialogs. The totals
 * below it are derived from the same payload, so switching the orders/sales
 * tab never refetches.
 *
 * Rendered by the admin and the vendor dashboards; `area` only picks where its
 * links lead.
 */
export function DashboardOrdersChart({
  series,
  area = "admin",
}: DashboardOrdersChartProps) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const intlLocale = useLocale();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale || intlLocale || "en";
  const { formatPrice } = useCurrency();
  const links = AREA_LINKS[area];
  const [view, setView] = React.useState<OrdersChartView>("orders");
  const [highlightsOpen, setHighlightsOpen] = React.useState(false);
  const [salesDataOpen, setSalesDataOpen] = React.useState(false);

  const numberFormatter = new Intl.NumberFormat(locale);
  const compactFormatter = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const { granularity } = series;
  const axisFormatter = new Intl.DateTimeFormat(locale, {
    ...BUCKET_FORMATS[granularity].axis,
    timeZone: "UTC",
  });
  const rowFormatter = new Intl.DateTimeFormat(locale, {
    ...BUCKET_FORMATS[granularity].row,
    timeZone: "UTC",
  });

  const periodLabel = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(new Date(series.from), new Date(series.to));

  const chartData = series.points.map((entry) => ({
    month: axisFormatter.format(new Date(entry.start)),
    inStore: view === "orders" ? entry.inStoreOrders : entry.inStoreSales,
    online: view === "orders" ? entry.onlineOrders : entry.onlineSales,
  }));

  const totals = series.points.reduce(
    (acc, entry) => {
      acc.orders += entry.inStoreOrders + entry.onlineOrders;
      acc.sales += entry.inStoreSales + entry.onlineSales;
      acc.inStoreOrders += entry.inStoreOrders;
      acc.onlineOrders += entry.onlineOrders;
      acc.inStoreSales += entry.inStoreSales;
      acc.onlineSales += entry.onlineSales;
      return acc;
    },
    {
      orders: 0,
      sales: 0,
      inStoreOrders: 0,
      onlineOrders: 0,
      inStoreSales: 0,
      onlineSales: 0,
    },
  );

  const seriesMax = chartData.reduce(
    (max, item) => Math.max(max, item.inStore, item.online),
    0,
  );
  const chartMaxValue =
    view === "orders" ? getNiceCountMax(seriesMax) : getNiceMax(seriesMax);
  const chartTicks = getChartTicks(chartMaxValue);

  const formatValue = (value: number) =>
    view === "orders" ? numberFormatter.format(value) : formatPrice(value);
  const totalChartValue = view === "orders" ? totals.orders : totals.sales;
  // The bar under the total splits it by channel. It used to measure the total
  // against a made-up round target ("0.00 … 100"), which meant nothing.
  const inStoreTotal =
    view === "orders" ? totals.inStoreOrders : totals.inStoreSales;
  const onlineTotal = view === "orders" ? totals.onlineOrders : totals.onlineSales;
  const inStoreShare =
    totalChartValue > 0 ? (inStoreTotal / totalChartValue) * 100 : 0;
  const onlineShare = totalChartValue > 0 ? 100 - inStoreShare : 0;

  return (
    <>
      <section className="overflow-hidden rounded-sm border-none bg-card shadow-sm">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {view === "orders"
                ? t("admin.dashboardPage.ordersTitle")
                : t("admin.dashboardPage.sales")}
            </h2>
            {/* The period is chosen at the top of the page; this only says
                what the bars are, so nobody has to guess what one bar means. */}
            <p className="truncate text-xs text-muted-foreground">
              {label(
                `admin.dashboardPage.granularity.${granularity}`,
                GRANULARITY_FALLBACK[granularity],
              )}{" "}
              · {periodLabel}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-8 w-full justify-center gap-2 rounded-[6px] border-border bg-muted/40 text-xs font-medium text-foreground hover:bg-muted/60 sm:w-auto"
                >
                  <Plus className="size-4" />
                  {t("admin.dashboardPage.addActivity")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  {t("admin.dashboardPage.quickActions")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {links.quickActions.map((link) => (
                  <DropdownMenuItem key={link.href} asChild>
                    <Link href={`${link.href}`}>{t(link.labelKey)}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px]">
          <div className="border-t p-4 sm:p-5 xl:border-t-0 xl:border-r">
            <div className="h-70 sm:h-85">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  barCategoryGap="22%"
                  barGap={4}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeDasharray="0"
                  />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    dy={8}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                    domain={[0, chartMaxValue]}
                    ticks={chartTicks}
                    tickFormatter={(value) => compactFormatter.format(Number(value))}
                    width={40}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", fillOpacity: 0.35 }}
                    contentStyle={{
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--card)",
                      color: "var(--foreground)",
                    }}
                    formatter={(value, name) => [
                      view === "orders"
                        ? numberFormatter.format(Number(value))
                        : formatPrice(Number(value)),
                      name === "inStore"
                        ? t("admin.dashboardPage.stats.inStore")
                        : t("admin.dashboardPage.stats.online"),
                    ]}
                  />
                  <Bar
                    dataKey="inStore"
                    fill="var(--primary)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={22}
                    activeBar={{ fill: "var(--primary)" }}
                  />
                  <Bar
                    dataKey="online"
                    fill="var(--muted-foreground)"
                    fillOpacity={0.45}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={22}
                    activeBar={{
                      fill: "var(--muted-foreground)",
                      fillOpacity: 0.45,
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="size-2.5 rounded-[2px] bg-blue-600" />
                {t("admin.dashboardPage.stats.inStore")}
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="size-2.5 rounded-[2px] bg-muted-foreground/50" />
                {t("admin.dashboardPage.stats.online")}
              </span>
            </div>
          </div>

          <div className="space-y-5 border-t p-5 xl:border-t-0">
            <div className="flex items-center gap-6 border-b text-sm">
              <button
                type="button"
                onClick={() => setView("orders")}
                className={cn(
                  "-mb-px border-b-2 pb-3 transition-colors",
                  view === "orders"
                    ? "border-foreground font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t("admin.dashboardPage.ordersTitle")}
              </button>
              <button
                type="button"
                onClick={() => setView("sales")}
                className={cn(
                  "-mb-px border-b-2 pb-3 transition-colors",
                  view === "sales"
                    ? "border-foreground font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t("admin.dashboardPage.sales")}
              </button>
            </div>

            <div>
              <p className="text-2xl font-semibold leading-tight tracking-tight text-foreground tabular-nums">
                {formatValue(totalChartValue)}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-blue-600"
                  style={{ width: `${inStoreShare}%` }}
                />
                <div
                  className="h-full bg-muted-foreground/50"
                  style={{ width: `${onlineShare}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px] bg-blue-600" />
                  {t("admin.dashboardPage.stats.inStore")}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatValue(inStoreTotal)}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px] bg-muted-foreground/50" />
                  {t("admin.dashboardPage.stats.online")}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatValue(onlineTotal)}
                  </span>
                </span>
              </div>
            </div>

            <p className="text-sm leading-6 text-muted-foreground">
              {t("admin.dashboardPage.ordersDescription")}
            </p>

            <div className="space-y-2">
              <ActionRow
                icon={<Megaphone className="size-4" />}
                label={t("admin.dashboardPage.showHighlights")}
                onClick={() => setHighlightsOpen(true)}
              />
              <ActionRow
                icon={<Blocks className="size-4" />}
                label={t("admin.dashboardPage.showSalesData")}
                onClick={() => setSalesDataOpen(true)}
              />
            </div>
          </div>
        </div>
      </section>

      <Dialog open={highlightsOpen} onOpenChange={setHighlightsOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("admin.dashboardPage.showHighlights")}</DialogTitle>
            <DialogDescription>
              {t("admin.dashboardPage.highlightsDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {t("admin.dashboardPage.ordersTitle")}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {numberFormatter.format(totals.orders)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {t("admin.dashboardPage.sales")}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {formatPrice(totals.sales)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {t("admin.dashboardPage.stats.inStore")}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {formatPrice(totals.inStoreSales)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {t("admin.dashboardPage.stats.online")}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {formatPrice(totals.onlineSales)}
              </p>
            </div>
          </div>
          <div
            className={cn(
              "grid grid-cols-1 gap-2",
              links.highlights.length > 1 && "sm:grid-cols-2",
            )}
          >
            {links.highlights.map((link) => (
              <Link
                key={link.href}
                href={`${link.href}`}
                className="inline-flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/50"
              >
                {t(link.labelKey)}
                <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={salesDataOpen} onOpenChange={setSalesDataOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("admin.dashboardPage.showSalesData")}</DialogTitle>
            <DialogDescription>{periodLabel}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[420px] overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/70">
                <tr className="border-b text-left">
                  <th className="px-3 py-2 font-medium">
                    {granularity === "month"
                      ? t("common.month")
                      : label("admin.dashboardPage.period.title", "Period")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("admin.dashboardPage.stats.inStore")}{" "}
                    {t("admin.dashboardPage.ordersTitle")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("admin.dashboardPage.stats.online")}{" "}
                    {t("admin.dashboardPage.ordersTitle")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("admin.dashboardPage.stats.inStore")}{" "}
                    {t("admin.dashboardPage.sales")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("admin.dashboardPage.stats.online")}{" "}
                    {t("admin.dashboardPage.sales")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {series.points.map((entry) => (
                  <tr key={entry.start} className="border-b">
                    <td className="px-3 py-2">
                      {rowFormatter.format(new Date(entry.start))}
                    </td>
                    <td className="px-3 py-2">
                      {numberFormatter.format(entry.inStoreOrders)}
                    </td>
                    <td className="px-3 py-2">
                      {numberFormatter.format(entry.onlineOrders)}
                    </td>
                    <td className="px-3 py-2">{formatPrice(entry.inStoreSales)}</td>
                    <td className="px-3 py-2">{formatPrice(entry.onlineSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button asChild variant="outline" className="h-8 text-xs">
              <Link href={`${links.report.href}`}>
                {t(links.report.labelKey)}
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <span className="inline-flex items-center gap-2.5 text-sm font-medium text-foreground">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-blue-600/10 text-blue-600">
          {icon}
        </span>
        {label}
      </span>
      <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
    </button>
  );
}
