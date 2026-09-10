import {
  BadgeCheck,
  Clock3,
  HandCoins,
  PackageCheck,
  ReceiptText,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { fetchAdminOrderStats } from "@/lib/orders/order-list";
import { getStoreMoneyFormatter } from "@/lib/intl/server-currency";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

interface OrdersStatsStripProps {
  locale: string;
  staffScope?: StaffAccessScope | null;
}

/**
 * Stats strip for the admin and staff order lists.
 *
 * A server component that reads its own counters, so both routes drop it in a
 * `<Suspense>` boundary and the orders table — the half admins actually came
 * for — renders without waiting on a store-wide aggregation.
 */
export async function OrdersStatsStrip({
  locale,
  staffScope,
}: OrdersStatsStripProps) {
  const [t, stats, money] = await Promise.all([
    getTranslations(),
    fetchAdminOrderStats(staffScope),
    getStoreMoneyFormatter(),
  ]);

  const count = (value: number) => new Intl.NumberFormat(locale).format(value);

  const items: AdminStatsStripItem[] = [
    {
      title: t("admin.ordersPage.stats.totalOrders.title"),
      value: count(stats.totalOrders),
      description: t("admin.ordersPage.stats.totalOrders.description"),
      icon: <ReceiptText className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("admin.ordersPage.stats.openOrders.title"),
      value: count(stats.openOrders),
      description: t("admin.ordersPage.stats.openOrders.description"),
      icon: <Clock3 className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: t("admin.ordersPage.stats.paidOrders.title"),
      value: count(stats.paidOrders),
      description: t("admin.ordersPage.stats.paidOrders.description"),
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("admin.ordersPage.stats.totalRevenue.title"),
      value: money(stats.totalRevenue),
      description: t("admin.ordersPage.stats.totalRevenue.description"),
      icon: <HandCoins className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
    {
      title: t("admin.ordersPage.stats.averageOrderValue.title"),
      value: money(stats.averageOrderValue),
      description: t("admin.ordersPage.stats.averageOrderValue.description"),
      icon: <PackageCheck className="h-5 w-5" />,
      iconClassName: "text-cyan-700 bg-cyan-100",
    },
  ];

  return <AdminStatsStrip items={items} />;
}
