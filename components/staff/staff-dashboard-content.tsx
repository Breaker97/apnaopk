"use client";

import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Crown,
  Package,
  PackageCheck,
  Receipt,
  ReceiptText,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";

export interface StaffRecentOrder {
  _id: string;
  orderNumber: string;
  customerName?: string;
  total: number;
  status: string;
  paymentStatus?: string;
  createdAt: string;
  itemsCount: number;
  primaryImage?: string;
  primaryName?: string;
}

interface StaffTopProduct {
  productId: string;
  name: string;
  image?: string;
  quantity: number;
  revenue: number;
}

interface StaffLowStockProduct {
  _id: string;
  name: string;
  image?: string;
  stock: number;
  status?: string;
}

interface StaffLatestCustomer {
  _id: string;
  name: string;
  email?: string;
  image?: string;
  loyaltyTier?: string;
  totalSpent?: number;
  createdAt: string;
}

interface StaffTodayStats {
  ordersToday: number;
  revenueToday: number;
  itemsSoldToday: number;
  newCustomersToday: number;
}

export interface StaffPosStats {
  salesToday: number;
  revenueToday: number;
  itemsSoldToday: number;
  averageSale: number;
}

export interface StaffPosSale {
  _id: string;
  orderNumber: string;
  total: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  itemsCount: number;
}

export interface StaffQuickLink {
  key: string;
  href: string;
  title: string;
  description: string;
  icon: "orders" | "products" | "inventory" | "customers" | "analytics" | "pos";
  accent: "blue" | "amber" | "green" | "violet" | "cyan" | "rose";
}

interface StaffDashboardContentProps {
  locale: string;
  userName: string;
  greeting: string;
  subtitle: string;
  stats: {
    totalOrders?: number;
    openOrders?: number;
    paidRevenue?: number;
    totalProducts?: number;
    lowStockProducts?: number;
    totalCustomers?: number;
  };
  todayStats?: StaffTodayStats;
  showTodayStats?: boolean;
  showOrdersToday?: boolean;
  showCustomersToday?: boolean;
  posStats?: StaffPosStats;
  posRecentSales?: StaffPosSale[];
  recentOrders: StaffRecentOrder[];
  topProducts?: StaffTopProduct[];
  lowStockItems?: StaffLowStockProduct[];
  latestCustomers?: StaffLatestCustomer[];
  quickLinks: StaffQuickLink[];
  showPosActivity?: boolean;
  showRecentOrders?: boolean;
  showStats?: boolean;
  showTopProducts?: boolean;
  showLowStock?: boolean;
  showLatestCustomers?: boolean;
}

const accentClassMap: Record<StaffQuickLink["accent"], string> = {
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  green:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  violet:
    "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  cyan: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

const statusPillClass: Record<string, string> = {
  pending:
    "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  processing:
    "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  shipped:
    "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  delivered:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  cancelled: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

const tierPillClass: Record<string, string> = {
  bronze:
    "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  silver: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300",
  gold: "bg-yellow-50 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300",
  platinum:
    "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

function getInitials(name: string) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function timeAgo(iso: string, locale: string) {
  try {
    const date = new Date(iso);
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

function labelize(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StaffDashboardContent({
  locale,
  userName,
  greeting,
  subtitle,
  stats,
  todayStats,
  showTodayStats,
  showOrdersToday,
  showCustomersToday,
  posStats,
  posRecentSales = [],
  recentOrders,
  topProducts = [],
  lowStockItems = [],
  latestCustomers = [],
  showPosActivity = false,
  showRecentOrders,
  showStats,
  showTopProducts,
  showLowStock,
  showLatestCustomers,
}: StaffDashboardContentProps) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();

  const tf = (key: string, fallback: string) => {
    return t.has(key as never) ? t(key as never) : fallback;
  };

  const numberFmt = new Intl.NumberFormat(locale);

  const statTiles: Array<{
    key: string;
    label: string;
    value: string;
    description: string;
    icon: LucideIcon;
    accent: StaffQuickLink["accent"];
  }> = [];

  if (typeof stats.totalOrders === "number") {
    statTiles.push({
      key: "orders",
      label: tf("admin.ordersPage.stats.totalOrders.title", "Total Orders"),
      value: numberFmt.format(stats.totalOrders),
      description: tf(
        "admin.ordersPage.stats.openOrders.title",
        `${stats.openOrders ?? 0} open`,
      ),
      icon: ClipboardList,
      accent: "blue",
    });
  }

  if (typeof stats.paidRevenue === "number") {
    statTiles.push({
      key: "revenue",
      label: tf("admin.ordersPage.stats.totalRevenue.title", "Total Revenue"),
      value: formatPrice(stats.paidRevenue),
      description: tf(
        "admin.ordersPage.stats.totalRevenue.description",
        "Gross paid order value",
      ),
      icon: PackageCheck,
      accent: "violet",
    });
  }

  if (typeof stats.totalProducts === "number") {
    statTiles.push({
      key: "products",
      label: tf("admin.productsPage.stats.totalProducts.title", "Products"),
      value: numberFmt.format(stats.totalProducts),
      description:
        typeof stats.lowStockProducts === "number"
          ? tf(
              "admin.productsPage.stats.outOfStock.title",
              `${stats.lowStockProducts} low stock`,
            )
          : tf(
              "admin.productsPage.stats.totalProducts.description",
              "Catalog size",
            ),
      icon: Package,
      accent: "amber",
    });
  }

  if (typeof stats.totalCustomers === "number") {
    statTiles.push({
      key: "customers",
      label: tf("admin.customersPage.stats.totalCustomers.title", "Customers"),
      value: numberFmt.format(stats.totalCustomers),
      description: tf(
        "admin.customersPage.stats.totalCustomers.description",
        "Registered customers",
      ),
      icon: Users,
      accent: "cyan",
    });
  }

  const todayTiles: Array<{
    key: string;
    label: string;
    value: string;
    icon: LucideIcon;
    accent: StaffQuickLink["accent"];
  }> = [];

  if (todayStats && showOrdersToday) {
    todayTiles.push({
      key: "orders-today",
      label: tf("admin.staffDashboard.ordersToday", "Orders today"),
      value: numberFmt.format(todayStats.ordersToday),
      icon: Receipt,
      accent: "blue",
    });
    todayTiles.push({
      key: "revenue-today",
      label: tf("admin.staffDashboard.revenueToday", "Revenue today"),
      value: formatPrice(todayStats.revenueToday),
      icon: CircleDollarSign,
      accent: "green",
    });
    todayTiles.push({
      key: "items-today",
      label: tf("admin.staffDashboard.itemsToday", "Items sold today"),
      value: numberFmt.format(todayStats.itemsSoldToday),
      icon: ShoppingBag,
      accent: "amber",
    });
  }
  if (todayStats && showCustomersToday) {
    todayTiles.push({
      key: "customers-today",
      label: tf("admin.staffDashboard.customersToday", "New customers today"),
      value: numberFmt.format(todayStats.newCustomersToday),
      icon: UserPlus,
      accent: "violet",
    });
  }

  const safePosStats: StaffPosStats = posStats ?? {
    salesToday: 0,
    revenueToday: 0,
    itemsSoldToday: 0,
    averageSale: 0,
  };

  const posTiles: Array<{
    key: string;
    label: string;
    value: string;
    icon: LucideIcon;
    accent: StaffQuickLink["accent"];
  }> = [
    {
      key: "pos-sales",
      label: tf("admin.staffDashboard.posSalesToday", "POS sales today"),
      value: numberFmt.format(safePosStats.salesToday),
      icon: ReceiptText,
      accent: "blue",
    },
    {
      key: "pos-revenue",
      label: tf("admin.staffDashboard.posRevenueToday", "POS revenue today"),
      value: formatPrice(safePosStats.revenueToday),
      icon: CircleDollarSign,
      accent: "green",
    },
    {
      key: "pos-items",
      label: tf("admin.staffDashboard.posItemsToday", "Items sold today"),
      value: numberFmt.format(safePosStats.itemsSoldToday),
      icon: ShoppingBag,
      accent: "amber",
    },
    {
      key: "pos-average",
      label: tf("admin.staffDashboard.averageSale", "Average sale"),
      value: formatPrice(safePosStats.averageSale),
      icon: BarChart3,
      accent: "cyan",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {greeting}
          {userName ? `, ${userName}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {/* Today's snapshot */}
      {showTodayStats && todayTiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {tf("admin.staffDashboard.todaysSnapshot", "Today's Snapshot")}
            </h2>
          </div>
          <div
            className={cn(
              "grid grid-cols-1 gap-3 sm:grid-cols-2",
              todayTiles.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
            )}
          >
            {todayTiles.map((tile) => {
              const Icon = tile.icon;
              return (
                <Card
                  key={tile.key}
                  className="rounded-[12px] border border-border/70 p-0 shadow-sm"
                >
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">
                        {tile.label}
                      </p>
                      <p className="mt-1 truncate text-xl font-bold text-foreground">
                        {tile.value}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-black/5 dark:ring-white/10",
                        accentClassMap[tile.accent],
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Lifetime stats strip */}
      {showStats && statTiles.length > 0 && (
        <Card className="overflow-hidden rounded-[12px] border border-border/70 p-0 shadow-sm">
          <div
            className={cn(
              "grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0",
              statTiles.length >= 4
                ? "xl:grid-cols-4"
                : statTiles.length === 3
                  ? "xl:grid-cols-3"
                  : "xl:grid-cols-2",
            )}
          >
            {statTiles.map((tile) => {
              const Icon = tile.icon;
              return (
                <div key={tile.key} className="px-6 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-md font-medium text-foreground/85">
                      {tile.label}
                    </CardTitle>
                    <div
                      className={cn(
                        "inline-flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-black/5 dark:ring-white/10",
                        accentClassMap[tile.accent],
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    <p className="text-2xl font-bold tracking-tight text-foreground">
                      {tile.value}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {tile.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* POS activity */}
      {showPosActivity && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {tf("admin.staffDashboard.todaysRegister", "Today's Register")}
              </h2>
            </div>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href={`/${locale}/staff/pos`}>
                <ShoppingCart className="h-3.5 w-3.5" />
                {tf("pos.newSale", "New Sale")}
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {posTiles.map((tile) => {
              const Icon = tile.icon;
              return (
                <Card
                  key={tile.key}
                  className="rounded-[12px] border border-border/70 p-0 shadow-sm"
                >
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">
                        {tile.label}
                      </p>
                      <p className="mt-1 truncate text-xl font-bold text-foreground">
                        {tile.value}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-black/5 dark:ring-white/10",
                        accentClassMap[tile.accent],
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent POS sales */}
      {showPosActivity && (
        <Card className="rounded-[12px] border border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
            <div>
              <CardTitle className="text-lg font-semibold">
                {tf("admin.staffDashboard.recentPosSales", "Recent POS sales")}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {tf(
                  "admin.staffDashboard.recentPosSalesHint",
                  "Latest receipts created from this staff account",
                )}
              </p>
            </div>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-sm">
              <Link href={`/${locale}/staff/pos`}>
                {tf("pos.openRegister", "Open register")}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto border-t border-border/60">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-[160px] px-6">
                      {tf("pos.receipt", "Receipt")}
                    </TableHead>
                    <TableHead>{tf("admin.staffDashboard.items", "Items")}</TableHead>
                    <TableHead>{tf("pos.paymentMethod", "Payment")}</TableHead>
                    <TableHead>{tf("common.status", "Status")}</TableHead>
                    <TableHead>{tf("admin.staffDashboard.time", "Time")}</TableHead>
                    <TableHead className="px-6 text-right">
                      {tf("pos.total", "Total")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posRecentSales.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-24 px-6 text-sm text-muted-foreground"
                      >
                        {tf(
                          "admin.staffDashboard.noPosSales",
                          "No POS sales recorded yet.",
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    posRecentSales.map((sale) => {
                      const statusKey = (sale.status || "").toLowerCase();
                      const pillClass =
                        statusPillClass[statusKey] ||
                        "bg-muted text-muted-foreground";
                      return (
                        <TableRow key={sale._id}>
                          <TableCell className="px-6">
                            <div className="font-semibold text-foreground">
                              {sale.orderNumber}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {numberFmt.format(sale.itemsCount)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="border-border/70 px-2.5 py-1 text-[11px] font-semibold"
                            >
                              {labelize(sale.paymentMethod)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "border-0 px-2.5 py-1 text-[11px] font-semibold capitalize",
                                pillClass,
                              )}
                            >
                              {tf(`orders.${statusKey}`, labelize(statusKey))}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {timeAgo(sale.createdAt, locale)}
                          </TableCell>
                          <TableCell className="px-6 text-right font-semibold text-foreground">
                            {formatPrice(sale.total)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Orders */}
      {showRecentOrders && (
        <Card className="rounded-[12px] border border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
            <div>
              <CardTitle className="text-lg font-semibold">
                {tf("admin.dashboardPage.recentOrders", "Recent Orders")}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {tf(
                  "admin.staffDashboard.recentOrdersSubtitle",
                  "Latest 5 orders across all channels",
                )}
              </p>
            </div>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-sm">
              <Link href={`/${locale}/staff/orders`}>
                {tf("common.viewAll", "View all")}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {recentOrders.length === 0 ? (
              <div className="px-6 pb-6 text-sm text-muted-foreground">
                {tf("admin.dashboardPage.noRecentOrders", "No orders yet")}
              </div>
            ) : (
              <div className="divide-y divide-border/60 border-t border-border/60">
                {recentOrders.map((order) => {
                  const statusKey = (order.status || "").toLowerCase();
                  const pillClass =
                    statusPillClass[statusKey] ||
                    "bg-muted text-muted-foreground";
                  return (
                    <Link
                      key={order._id}
                      href={`/${locale}/staff/orders/${order._id}`}
                      className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-muted/40"
                    >
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                        {order.primaryImage ? (
                          <AppImage
                            src={order.primaryImage}
                            alt={order.primaryName || order.orderNumber}
                            fill
                            className="object-cover"
                            sizes="48px"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <PackageCheck className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {order.orderNumber}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {order.customerName ||
                            tf("common.guest", "Guest")}
                          {" • "}
                          {order.itemsCount}{" "}
                          {order.itemsCount === 1
                            ? tf("admin.dashboardPage.pc", "Pc")
                            : tf("admin.dashboardPage.pcs", "Pcs")}
                          {" • "}
                          {timeAgo(order.createdAt, locale)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-0 px-2.5 py-1 text-[11px] font-semibold capitalize",
                          pillClass,
                        )}
                      >
                        {tf(`orders.${statusKey}`, labelize(statusKey))}
                      </Badge>
                      <p className="hidden text-right text-sm font-semibold text-foreground sm:block">
                        {formatPrice(order.total)}
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Two-column secondary panels */}
      {(showTopProducts || showLowStock) && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {showTopProducts && (
            <Card className="rounded-[12px] border border-border/70 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <div>
                    <CardTitle className="text-lg font-semibold">
                      {tf("admin.staffDashboard.topProducts", "Top selling products")}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tf("admin.staffDashboard.last30Days", "Last 30 days")}
                    </p>
                  </div>
                </div>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-sm"
                >
                  <Link href={`/${locale}/staff/products`}>
                    {tf("common.viewAll", "View all")}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {topProducts.length === 0 ? (
                  <div className="px-6 pb-6 text-sm text-muted-foreground">
                    {tf(
                      "admin.staffDashboard.noTopProducts",
                      "No product sales yet in this period.",
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-border/60 border-t border-border/60">
                    {topProducts.map((product, index) => (
                      <div
                        key={product.productId}
                        className="flex items-center gap-4 px-6 py-3"
                      >
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
                          {index + 1}
                        </span>
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                          {product.image ? (
                            <AppImage
                              src={product.image}
                              alt={product.name}
                              fill
                              className="object-cover"
                              sizes="40px"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <Package className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {product.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {numberFmt.format(product.quantity)}{" "}
                            {tf("admin.staffDashboard.unitsSold", "sold")}
                          </p>
                        </div>
                        <p className="text-right text-sm font-semibold text-foreground">
                          {formatPrice(product.revenue)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {showLowStock && (
            <Card className="rounded-[12px] border border-border/70 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <div>
                    <CardTitle className="text-lg font-semibold">
                      {tf("admin.staffDashboard.lowStock", "Low stock alerts")}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tf(
                        "admin.staffDashboard.lowStockHint",
                        "Products with 5 or fewer units left",
                      )}
                    </p>
                  </div>
                </div>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-sm"
                >
                  <Link href={`/${locale}/staff/inventory`}>
                    {tf("common.viewAll", "View all")}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {lowStockItems.length === 0 ? (
                  <div className="px-6 pb-6 text-sm text-muted-foreground">
                    {tf(
                      "admin.staffDashboard.noLowStock",
                      "All products are sufficiently stocked.",
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-border/60 border-t border-border/60">
                    {lowStockItems.map((item) => (
                      <div
                        key={item._id}
                        className="flex items-center gap-4 px-6 py-3"
                      >
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                          {item.image ? (
                            <AppImage
                              src={item.image}
                              alt={item.name}
                              fill
                              className="object-cover"
                              sizes="40px"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <Package className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {item.name}
                          </p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {item.status || "active"}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-0 px-2.5 py-1 text-[11px] font-semibold",
                            item.stock <= 0
                              ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
                          )}
                        >
                          {item.stock <= 0
                            ? tf("admin.staffDashboard.outOfStock", "Out of stock")
                            : `${numberFmt.format(item.stock)} ${tf("admin.staffDashboard.left", "left")}`}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Latest Customers */}
      {showLatestCustomers && (
        <Card className="rounded-[12px] border border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-cyan-600" />
              <div>
                <CardTitle className="text-lg font-semibold">
                  {tf("admin.staffDashboard.latestCustomers", "Latest customers")}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tf(
                    "admin.staffDashboard.latestCustomersHint",
                    "Most recently registered customers",
                  )}
                </p>
              </div>
            </div>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-sm">
              <Link href={`/${locale}/staff/customers`}>
                {tf("common.viewAll", "View all")}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {latestCustomers.length === 0 ? (
              <div className="px-6 pb-6 text-sm text-muted-foreground">
                {tf(
                  "admin.staffDashboard.noLatestCustomers",
                  "No customers registered yet.",
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/60 border-t border-border/60">
                {latestCustomers.map((customer) => {
                  const tierKey = (customer.loyaltyTier || "").toLowerCase();
                  const tierClass =
                    tierPillClass[tierKey] ||
                    "bg-muted text-muted-foreground";
                  return (
                    <Link
                      key={customer._id}
                      href={`/${locale}/staff/customers/${customer._id}`}
                      className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-muted/40"
                    >
                      <Avatar className="h-10 w-10 border border-border">
                        <AvatarImage
                          src={customer.image}
                          alt={customer.name}
                        />
                        <AvatarFallback className="text-xs">
                          {getInitials(customer.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {customer.name || customer.email || ""}
                          </p>
                          {tierKey && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "border-0 px-1.5 py-0 text-[10px] font-semibold capitalize",
                                tierClass,
                              )}
                            >
                              <Crown className="mr-0.5 h-2.5 w-2.5" />
                              {tierKey}
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {customer.email || ""}
                          {" • "}
                          {timeAgo(customer.createdAt, locale)}
                        </p>
                      </div>
                      {typeof customer.totalSpent === "number" && (
                        <p className="hidden text-right text-sm font-semibold text-foreground sm:block">
                          {formatPrice(customer.totalSpent)}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
