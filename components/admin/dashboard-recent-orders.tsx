"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PackageCheck, User } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { cn, truncateByWords } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import { getPaymentMethodMeta } from "@/components/common/payment-method-meta";
import type { RecentOrder } from "@/lib/admin/dashboard-types";

function getStatusPill(t: ReturnType<typeof useTranslations>, orderStatus: string) {
  const config: Record<string, { label: string; className: string }> = {
    pending: {
      label: t("admin.dashboardPage.status.pending"),
      className: "bg-red-500/15 text-red-600 dark:text-red-400",
    },
    processing: {
      label: t("admin.dashboardPage.status.processing"),
      className: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    },
    shipped: {
      label: t("admin.dashboardPage.status.shipped"),
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    },
    delivered: {
      label: t("admin.dashboardPage.status.delivered"),
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    },
    cancelled: {
      label: t("admin.dashboardPage.status.cancelled"),
      className: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    },
  };
  return config[orderStatus] || config.pending;
}

/** The five newest orders, already flattened server-side to one line per order. */
export function DashboardRecentOrders({ orders }: { orders: RecentOrder[] }) {
  const t = useTranslations();
  const intlLocale = useLocale();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale || intlLocale || "en";
  const { formatPrice } = useCurrency();

  return (
    <section className="rounded-sm border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t("admin.dashboardPage.recentOrders")}
        </h2>
        <Link
          href={`/${locale}/admin/orders`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {t("admin.dashboardPage.viewAllOrders")}
        </Link>
      </div>

      <div className="mt-4 space-y-3">
        {orders.length === 0 ? (
          <div className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {t("admin.dashboardPage.noRecentOrders")}
          </div>
        ) : (
          orders.map((order) => (
            <RecentOrderCard
              key={order._id}
              order={order}
              locale={locale}
              t={t}
              formatPrice={formatPrice}
            />
          ))
        )}
      </div>
    </section>
  );
}

function RecentOrderCard({
  order,
  locale,
  t,
  formatPrice,
}: {
  order: RecentOrder;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  formatPrice: (amount: number) => string;
}) {
  const statusMeta = getStatusPill(t, order.status);
  const paymentMeta = getPaymentMethodMeta(t, order.paymentMethod);
  const productName = order.primaryItemName;
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
      href={`/${locale}/admin/orders/${order._id}`}
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
              <p className="shrink-0 text-sm font-semibold text-foreground">
                {formatPrice(order.total)}
              </p>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs text-muted-foreground">
                {order.orderNumber}
              </span>
              <span
                className={cn(
                  "inline-flex rounded-sm px-1.5 py-0.5 text-xs font-medium",
                  statusMeta.className,
                )}
              >
                {statusMeta.label}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <User className="size-3.5" />
            <span className="text-foreground">
              {order.customerName || t("common.guest")}
            </span>
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
          {order.customerName || t("common.guest")}
        </p>
      </div>

      <div className="hidden sm:block">
        <p className="text-xs text-muted-foreground">{t("common.qty")}</p>
        <p className="mt-1 text-sm font-medium text-foreground">{qtyLabel}</p>
      </div>

      <div className="hidden sm:block">
        <p className="text-xs text-muted-foreground">{t("common.status")}</p>
        <span
          className={cn(
            "mt-1 inline-flex rounded-sm px-2 py-1 text-xs font-medium",
            statusMeta.className,
          )}
        >
          {statusMeta.label}
        </span>
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
        <p className="text-xs text-muted-foreground">
          {t("admin.dashboardPage.totalPrice")}
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {formatPrice(order.total)}
        </p>
      </div>
    </Link>
  );
}
