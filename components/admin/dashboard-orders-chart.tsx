"use client";

import Link from "next/link";
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
import { getChartTicks, getNiceMax } from "@/lib/admin/dashboard-chart-scale";
import type { OrderChartPoint } from "@/lib/admin/dashboard-types";
import {
  DateRangePicker,
  formatAppliedDateRange,
  startOfDay,
  type AppliedDateRange,
} from "@/components/ui/date-range-picker";

type OrdersChartView = "orders" | "sales";

function getInitialDateRange(data: OrderChartPoint[]): AppliedDateRange {
  if (data.length === 0) {
    const now = startOfDay(new Date());
    return { from: now, to: now };
  }

  const first = data[0];
  const last = data[data.length - 1];
  return {
    from: startOfDay(new Date(first.year, first.monthIndex, 1)),
    to: startOfDay(new Date(last.year, last.monthIndex + 1, 0)),
  };
}

/**
 * Trailing-12-month orders/sales chart with its side panel and drill-down
 * dialogs. Filtering and the totals below it are derived from the same server
 * payload, so switching the range or the orders/sales tab never refetches.
 */
export function DashboardOrdersChart({ data }: { data: OrderChartPoint[] }) {
  const t = useTranslations();
  const intlLocale = useLocale();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale || intlLocale || "en";
  const { formatPrice } = useCurrency();
  const [view, setView] = React.useState<OrdersChartView>("orders");
  const [dateRange, setDateRange] = React.useState<AppliedDateRange>(() =>
    getInitialDateRange(data),
  );
  const [highlightsOpen, setHighlightsOpen] = React.useState(false);
  const [salesDataOpen, setSalesDataOpen] = React.useState(false);

  const numberFormatter = new Intl.NumberFormat(locale);
  const compactFormatter = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const monthFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  });
  const monthYearFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  const filteredData = data.filter((entry) => {
    const monthDate = startOfDay(new Date(entry.year, entry.monthIndex, 1));
    return monthDate >= dateRange.from && monthDate <= dateRange.to;
  });

  const chartData = filteredData.map((entry) => ({
    month: monthFormatter.format(new Date(Date.UTC(entry.year, entry.monthIndex, 1))),
    inStore: view === "orders" ? entry.inStoreOrders : entry.inStoreSales,
    online: view === "orders" ? entry.onlineOrders : entry.onlineSales,
  }));

  const totals = filteredData.reduce(
    (acc, entry) => {
      acc.orders += entry.inStoreOrders + entry.onlineOrders;
      acc.sales += entry.inStoreSales + entry.onlineSales;
      acc.inStoreSales += entry.inStoreSales;
      acc.onlineSales += entry.onlineSales;
      return acc;
    },
    { orders: 0, sales: 0, inStoreSales: 0, onlineSales: 0 },
  );

  const chartMaxValue = getNiceMax(
    chartData.reduce((max, item) => Math.max(max, item.inStore, item.online), 0),
  );
  const chartTicks = getChartTicks(chartMaxValue);

  const totalChartValue = view === "orders" ? totals.orders : totals.sales;
  const totalChartTarget = Math.max(
    getNiceMax(totalChartValue),
    view === "orders" ? 100 : 1000,
  );
  const totalChartProgress =
    totalChartTarget > 0
      ? Math.min((totalChartValue / totalChartTarget) * 100, 100)
      : 0;

  return (
    <>
      <section className="overflow-hidden rounded-sm border-none bg-card shadow-sm">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {view === "orders"
              ? t("admin.dashboardPage.ordersTitle")
              : t("admin.dashboardPage.sales")}
          </h2>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <DateRangePicker
              value={dateRange}
              onApply={setDateRange}
              locale={locale}
              cancelLabel={t("common.cancel")}
              applyLabel={t("common.apply")}
            />
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
                <DropdownMenuItem asChild>
                  <Link href={`/${locale}/admin/products/new`}>
                    {t("admin.dashboardPage.addProduct")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/${locale}/admin/categories/new`}>
                    {t("admin.dashboardPage.addCategory")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/${locale}/admin/collections/new`}>
                    {t("admin.dashboardPage.addCollection")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/${locale}/admin/customers/new`}>
                    {t("admin.dashboardPage.addCustomer")}
                  </Link>
                </DropdownMenuItem>
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
                {view === "orders"
                  ? numberFormatter.format(totalChartValue)
                  : formatPrice(totalChartValue)}
              </p>
            </div>

            <div className="space-y-2">
              <div className="h-1.5 rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-blue-600"
                  style={{ width: `${totalChartProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>0.00</span>
                <span>
                  {view === "orders"
                    ? numberFormatter.format(totalChartTarget)
                    : formatPrice(totalChartTarget)}
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
        <DialogContent className="max-w-xl">
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Link
              href={`/${locale}/admin/analytics`}
              className="inline-flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/50"
            >
              {t("admin.sidebar.analytics")}
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
            <Link
              href={`/${locale}/admin/orders`}
              className="inline-flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/50"
            >
              {t("admin.sidebar.orders")}
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={salesDataOpen} onOpenChange={setSalesDataOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("admin.dashboardPage.showSalesData")}</DialogTitle>
            <DialogDescription>
              {formatAppliedDateRange(dateRange, locale)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[420px] overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/70">
                <tr className="border-b text-left">
                  <th className="px-3 py-2 font-medium">{t("common.month")}</th>
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
                {filteredData.map((entry) => (
                  <tr key={`${entry.year}-${entry.monthIndex}`} className="border-b">
                    <td className="px-3 py-2">
                      {monthYearFormatter.format(
                        new Date(Date.UTC(entry.year, entry.monthIndex, 1)),
                      )}
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
            <Link href={`/${locale}/admin/analytics`}>
              <Button variant="outline" className="h-8 text-xs">
                {t("admin.sidebar.analytics")}
              </Button>
            </Link>
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
