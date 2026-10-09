"use client";

import Link from "@/components/language/link";
import { AppImage } from "@/components/ui/app-image";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  DollarSign,
  Package,
  PackageCheck,
  ShoppingCart,
  Plus,
  TrendingUp,
  ChevronRight,
  Settings,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/providers/currency-provider";
import {
  DashboardStatsGrid,
  DashboardStatsGridSkeleton,
  type DashboardStatCardItem,
} from "@/components/admin/dashboard-stat-card";
import { DashboardOrdersChart } from "@/components/admin/dashboard-orders-chart";
import { DashboardPeriodPicker } from "@/components/admin/dashboard-period-picker";
import {
  OrdersChartSkeleton,
  RecentOrdersSkeleton,
} from "@/components/admin/dashboard-skeleton";
import { getPaymentMethodMeta } from "@/components/common/payment-method-meta";
import { VendorFulfillmentBadge } from "@/components/vendor/vendor-fulfillment-badge";
import { truncateByWords } from "@/lib/utils";
import type {
  VendorDashboardData,
  VendorRecentOrder,
} from "@/lib/vendors/vendor-dashboard-types";

/** The page's resolved period (`resolveDashboardPeriod`), as the picker takes it. */
interface VendorDashboardPeriod {
  /** A named period, or "custom" when dates were picked. */
  key: string;
  /** "YYYY-MM-DD" bounds, empty for "All time". */
  from: string;
  to: string;
}

/** What `GET /api/vendor/analytics` reads the period from. */
function periodQuery({ key, from, to }: VendorDashboardPeriod) {
  return (
    key === "custom"
      ? new URLSearchParams({ from, to })
      : new URLSearchParams({ period: key })
  ).toString();
}

/**
 * The vendor's dashboard. Every figure comes from `GET /api/vendor/analytics`,
 * which reads the same module (`lib/vendors/vendor-order-metrics.ts`) as the
 * vendor orders page, so the cards, the chart and the recent orders agree with
 * the order list rather than each computing their own version of it.
 *
 * The period picker is the admin dashboard's, and holds the period in the URL
 * the same way; the cards and the chart follow it, the recent orders do not.
 */
export function VendorDashboardContent({
  setupMode = false,
  period,
}: {
  setupMode?: boolean;
  period: VendorDashboardPeriod;
}) {
  const t = useTranslations();
  const intlLocale = useLocale();
  const params = useParams();
  const locale = (params.locale as string) || intlLocale || "en";
  const { formatPrice } = useCurrency();

  const query = periodQuery(period);
  // The last response and the period it answered, so a period change can tell
  // "still loading the new one" from "loaded" without a loading flag to reset.
  const [loaded, setLoaded] = useState<{
    query: string;
    data: VendorDashboardData | null;
  } | null>(null);

  useEffect(() => {
    if (setupMode) return;
    let cancelled = false;
    async function fetchAnalytics() {
      let data: VendorDashboardData | null = null;
      try {
        const res = await fetch(`/api/vendor/analytics?${query}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            data = json.data;
          }
        }
      } catch (error) {
        console.error("Failed to fetch analytics:", error);
      }
      // A slower answer to a period the vendor has already moved off.
      if (!cancelled) setLoaded({ query, data });
    }
    fetchAnalytics();
    return () => {
      cancelled = true;
    };
  }, [setupMode, query]);

  if (setupMode) {
    const setupActions = [
      {
        href: "/vendor/products/new",
        icon: <Plus className="size-5" />,
        title: "Add a product",
        description:
          "Create product drafts now. They stay hidden from customers until subscription payment activates your store.",
      },
      {
        href: "/vendor/products",
        icon: <Package className="size-5" />,
        title: "Prepare your catalog",
        description:
          "Review products, inventory, categories, collections, and brands.",
      },
      {
        href: "/vendor/settings",
        icon: <Settings className="size-5" />,
        title: "Configure your store",
        description:
          "Finish store details, branding, shipping, and notification settings.",
      },
    ];

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Store setup dashboard
          </h2>
          <p className="mt-1 text-muted-foreground">
            Prepare your store during the seven-day setup period. Selling and
            financial activity will unlock only after payment.
          </p>
        </div>
        <section className="overflow-hidden border bg-card">
          <div className="border-b px-5 py-4">
            <h3 className="font-semibold text-foreground">Setup checklist</h3>
          </div>
          <div className="divide-y">
            {setupActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                  {action.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">
                    {action.title}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                    {action.description}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    );
  }

  // The answer to THIS period, if it has come. Until then the cards and the
  // chart show their skeletons; the header stays mounted so the open picker
  // does not vanish under the click that changed it.
  const current = loaded?.query === query ? loaded : null;
  const data = current?.data ?? null;
  // Not period-driven, so the last answer keeps them on screen meanwhile.
  const recentOrders = (current ?? loaded)?.data?.recentOrders;

  const stats = data?.stats;
  const dashboardStats: DashboardStatCardItem[] = stats
    ? [
        {
          id: "vendor-total-revenue",
          label: t("vendor.totalRevenue"),
          value: formatPrice(stats.totalRevenue),
          icon: <DollarSign className="w-5 h-5" />,
          // Revenue is money collected. What unpaid orders are still worth sits
          // beside it, so an order awaiting cash on delivery is not just missing.
          subLabel:
            stats.awaitingPayment > 0
              ? t("vendor.awaitingPayment", {
                  amount: formatPrice(stats.awaitingPayment),
                })
              : undefined,
        },
        {
          id: "vendor-net-earnings",
          label: t("vendor.netEarnings"),
          value: formatPrice(stats.netEarnings),
          icon: <TrendingUp className="w-5 h-5" />,
        },
        {
          id: "vendor-total-orders",
          label: t("vendor.totalOrders"),
          value: stats.totalOrders.toLocaleString(locale),
          icon: <ShoppingCart className="w-5 h-5" />,
          // The orders page's "Open Orders" figure.
          subLabel:
            stats.openOrders > 0
              ? t("vendor.openOrdersCount", {
                  count: stats.openOrders.toLocaleString(locale),
                })
              : undefined,
        },
        {
          id: "vendor-active-products",
          label: t("vendor.activeProducts"),
          value: stats.activeProducts.toLocaleString(locale),
          icon: <Package className="w-5 h-5" />,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            {t("common.dashboard")}
          </h2>
          <p className="text-muted-foreground">
            {t("vendor.dashboardSubtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardPeriodPicker
            period={period.key}
            from={period.from}
            to={period.to}
          />
          <Button asChild variant="outline">
            <Link href="/vendor/orders">
              <ShoppingCart className="mr-2 h-4 w-4" />
              {t("vendor.viewOrders")}
            </Link>
          </Button>
          <Button asChild>
            <Link href="/vendor/products/new">
              <Plus className="mr-2 h-4 w-4" />
              {t("vendor.addProduct")}
            </Link>
          </Button>
        </div>
      </div>

      {current && !data ? (
        <div className="text-center py-12 text-muted-foreground">
          {t("vendor.unableToLoadData")}
        </div>
      ) : (
        <>
          {data ? (
            <>
              <DashboardStatsGrid
                stats={dashboardStats}
                cardClassName="px-4 py-4"
              />
              <DashboardOrdersChart series={data.chart} area="vendor" />
            </>
          ) : (
            <>
              <DashboardStatsGridSkeleton items={4} cardClassName="px-4 py-4" />
              <OrdersChartSkeleton />
            </>
          )}

          {recentOrders ? (
            <VendorRecentOrders orders={recentOrders} formatPrice={formatPrice} />
          ) : (
            <RecentOrdersSkeleton />
          )}
        </>
      )}
    </div>
  );
}

function VendorRecentOrders({
  orders,
  formatPrice,
}: {
  orders: VendorRecentOrder[];
  formatPrice: (amount: number) => string;
}) {
  const t = useTranslations();

  return (
    <section className="rounded-sm border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          {t("vendor.recentOrders")}
        </h3>
        <Link
          href="/vendor/orders"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {t("admin.dashboardPage.viewAllOrders")}
        </Link>
      </div>

      <div className="mt-4 space-y-3">
        {orders.length === 0 ? (
          <div className="rounded-xl border border-border px-4 py-10 text-center text-muted-foreground">
            {t("admin.dashboardPage.noRecentOrders")}
          </div>
        ) : (
          orders.map((order) => (
            <VendorRecentOrderCard
              key={order._id}
              order={order}
              formatPrice={formatPrice}
            />
          ))
        )}
      </div>
    </section>
  );
}

/**
 * One recent order, showing what the vendor order list shows for the same
 * order: this vendor's lines and quantity, the customer, the consignment's
 * fulfilment badge and the "Net sales" figure.
 */
export function VendorRecentOrderCard({
  order,
  formatPrice,
}: {
  order: VendorRecentOrder;
  formatPrice: (amount: number) => string;
}) {
  const t = useTranslations();
  const paymentMeta = getPaymentMethodMeta(t, order.paymentMethod);
  const productName = order.primaryItemName;
  const customerName = order.walkIn
    ? t("admin.orderDetails.walkInCustomer")
    : order.customerName || t("vendor.ordersTable.guest");
  const amountLabel = t("vendor.ordersTable.columns.netSales");
  const fallbackName = t("admin.dashboardPage.orderLabel", {
    orderNumber: order.orderNumber,
  });
  // The mobile layout gives the name a full-width row, so it can afford more
  // words than the narrow desktop column.
  const displayProductName = productName
    ? truncateByWords(productName, 5)
    : fallbackName;
  const mobileProductName = productName
    ? truncateByWords(productName, 8)
    : fallbackName;
  const qtyLabel = `${order.itemCount} ${
    order.itemCount === 1
      ? t("admin.dashboardPage.pc")
      : t("admin.dashboardPage.pcs")
  }`;

  return (
    <Link
      href={`/vendor/orders/${order._id}`}
      className="block rounded-sm border border-border px-4 py-3 transition-colors hover:bg-muted/40 active:bg-muted/60 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-[minmax(260px,2.1fr)_1.1fr_0.6fr_0.8fr_1fr_0.7fr]"
    >
      {/* Mobile: compact summary — image + name + price on one row, then a
          single meta line. Replaces the six stacked label/value rows that the
          desktop grid collapses into below `sm`. */}
      <div className="sm:hidden">
        <div className="flex items-start gap-3">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
            {order.primaryItemImage ? (
              <AppImage
                src={order.primaryItemImage}
                alt={productName || order.orderNumber}
                fill
                className="object-cover"
                sizes="48px"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                <PackageCheck className="size-4" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="line-clamp-2 min-w-0 text-sm font-medium leading-snug text-foreground">
                {mobileProductName}
              </p>
              <p className="shrink-0 text-base font-semibold text-foreground">
                {formatPrice(order.netSales)}
              </p>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs text-muted-foreground">
                {order.orderNumber}
              </span>
              <VendorFulfillmentBadge
                status={order.status}
                pickupStatus={order.pickupStatus}
                className="px-1.5 py-0.5 text-[11px]"
              />
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <User className="size-3.5" />
            <span className="text-foreground">{customerName}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-foreground">{qtyLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <paymentMeta.Icon className="size-3.5" />
            <span className="text-foreground">{paymentMeta.label}</span>
          </span>
        </div>
      </div>

      <div className="hidden items-center gap-3 sm:flex sm:col-span-2 lg:col-span-1">
        <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-border bg-muted">
          {order.primaryItemImage ? (
            <AppImage
              src={order.primaryItemImage}
              alt={productName || order.orderNumber}
              fill
              className="object-cover"
              sizes="64px"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
              <PackageCheck className="size-5" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p
            className="truncate text-sm font-medium text-foreground"
            title={
              productName && displayProductName !== productName
                ? productName
                : undefined
            }
          >
            {displayProductName}
          </p>
          <p className="text-xs text-muted-foreground">{order.orderNumber}</p>
        </div>
      </div>

      <div className="hidden sm:block">
        <p className="text-xs text-muted-foreground">
          {t("admin.dashboardPage.customer")}
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">
          {customerName}
        </p>
      </div>

      <div className="hidden sm:block">
        <p className="text-xs text-muted-foreground">{t("common.qty")}</p>
        <p className="mt-1 text-sm font-medium text-foreground">{qtyLabel}</p>
      </div>

      <div className="hidden sm:block">
        <p className="text-xs text-muted-foreground">{t("common.status")}</p>
        <VendorFulfillmentBadge
          status={order.status}
          pickupStatus={order.pickupStatus}
          className="mt-1"
        />
      </div>

      <div className="hidden sm:block">
        <p className="text-xs text-muted-foreground">
          {t("admin.dashboardPage.paymentMethod")}
        </p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          <paymentMeta.Icon className="size-3.5 text-muted-foreground" />
          {paymentMeta.label}
        </p>
      </div>

      <div className="hidden sm:block sm:col-span-2 lg:col-span-1 lg:text-right">
        <p className="text-xs text-muted-foreground">{amountLabel}</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {formatPrice(order.netSales)}
        </p>
      </div>
    </Link>
  );
}
