import { Suspense } from "react";
import {
  BadgeCheck,
  Clock3,
  HandCoins,
  PackageCheck,
  ReceiptText,
} from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { VendorOrdersTable } from "@/components/vendor/orders-table";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { parsePageQuery } from "@/lib/api/validate";
import { serializeRows } from "@/lib/api/list-query";
import { OrderListQuerySchema } from "@/lib/validations";
import { fetchVendorOrderList } from "@/lib/vendors/vendor-order-list";
import { getVendorOrderTotals } from "@/lib/vendors/vendor-order-metrics";
import { getStoreMoneyFormatter } from "@/lib/intl/server-currency";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface VendorOrdersStats {
  totalOrders: number;
  openOrders: number;
  paidOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
}

export default async function VendorOrdersPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  const search = await searchParams;
  setRequestLocale(locale);
  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_ORDERS],
  });
  const vendor = await requireApprovedVendorByUserId(access.session.user.id);
  const canEditOrder =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_ORDERS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.EDIT_ORDERS);
  const canDeleteOrder =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_ORDERS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.DELETE_ORDERS);
  const canCreateOrder =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_ORDERS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.CREATE_ORDERS);

  const [stats, formatCurrency] = await Promise.all([
    getVendorOrdersStats(String(vendor._id)),
    getStoreMoneyFormatter(),
  ]);

  const statItems: AdminStatsStripItem[] = [
    {
      title: t("admin.ordersPage.stats.totalOrders.title"),
      value: new Intl.NumberFormat(locale).format(stats.totalOrders),
      description: t("admin.ordersPage.stats.totalOrders.description"),
      icon: <ReceiptText className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("admin.ordersPage.stats.openOrders.title"),
      value: new Intl.NumberFormat(locale).format(stats.openOrders),
      description: t("admin.ordersPage.stats.openOrders.description"),
      icon: <Clock3 className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: t("admin.ordersPage.stats.paidOrders.title"),
      value: new Intl.NumberFormat(locale).format(stats.paidOrders),
      description: t("admin.ordersPage.stats.paidOrders.description"),
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("admin.ordersPage.stats.totalRevenue.title"),
      value: formatCurrency(stats.totalRevenue),
      description: t("admin.ordersPage.stats.totalRevenue.description"),
      icon: <HandCoins className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
    {
      title: t("admin.ordersPage.stats.averageOrderValue.title"),
      value: formatCurrency(stats.averageOrderValue),
      description: t("admin.ordersPage.stats.averageOrderValue.description"),
      icon: <PackageCheck className="h-5 w-5" />,
      iconClassName: "text-cyan-700 bg-cyan-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={statItems} />
      <Suspense
        fallback={
          <AdminListSkeleton stats={0} columns={6} tabs={5} thumbnail />
        }
      >
        <VendorOrdersTableSection
          locale={locale}
          searchParams={search}
          vendorId={String(vendor._id)}
          canEditOrder={canEditOrder}
          canDeleteOrder={canDeleteOrder}
          canCreateOrder={canCreateOrder}
        />
      </Suspense>
    </div>
  );
}

/**
 * The strip's counters, from the module the vendor dashboard reads too — so
 * "Total Revenue" here and on the dashboard is one number.
 */
async function getVendorOrdersStats(vendorId: string): Promise<VendorOrdersStats> {
  const totals = await getVendorOrderTotals(vendorId);

  return {
    totalOrders: totals.totalOrders,
    openOrders: totals.openOrders,
    paidOrders: totals.paidOrders,
    totalRevenue: totals.totalRevenue,
    averageOrderValue:
      totals.paidOrders > 0 ? totals.totalRevenue / totals.paidOrders : 0,
  };
}

async function VendorOrdersTableSection({
  locale,
  searchParams,
  vendorId,
  canEditOrder,
  canDeleteOrder,
  canCreateOrder,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
  vendorId: string;
  canEditOrder: boolean;
  canDeleteOrder: boolean;
  canCreateOrder: boolean;
}) {
  // Parsed with the schema the API route uses, so the page and the endpoint
  // can never read one query string two different ways.
  const query = parsePageQuery(searchParams, OrderListQuerySchema);
  const view =
    typeof searchParams.view === "string" ? searchParams.view : "all";
  const list = await fetchVendorOrderList({ ...query, view }, vendorId);

  return (
    <VendorOrdersTable
      locale={locale}
      canEditOrder={canEditOrder}
      canDeleteOrder={canDeleteOrder}
      canCreateOrder={canCreateOrder}
      data={serializeRows(list.items)}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
    />
  );
}
