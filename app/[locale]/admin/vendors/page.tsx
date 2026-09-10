import { Suspense } from "react";
import { BadgeCheck, CircleAlert, Clock3, HandCoins, Store } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connectDB } from "@/lib/db";
import { VENDOR_STATUS } from "@/config/app.config";
import { Vendor } from "@/models";
import {
  AdminStatsStrip,
  AdminStatsStripSkeleton,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { VendorsDataTable } from "@/components/admin/vendors-data-table";
import {
  getExternalVendorFilter,
  isMultiVendorEnabled,
  syncDefaultVendorWithSettings,
} from "@/lib/vendors/multi-vendor";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { parsePageQuery } from "@/lib/api/validate";
import { serializeRows } from "@/lib/api/list-query";
import { AdminListQuerySchema } from "@/lib/validations";
import { fetchAdminVendorList } from "@/lib/vendors/vendor-list";
import { getVendorSalesTotals } from "@/lib/vendors/vendor-sales";
import { getStoreMoneyFormatter } from "@/lib/intl/server-currency";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface VendorsStats {
  totalVendors: number;
  approvedVendors: number;
  pendingVendors: number;
  flaggedVendors: number;
  totalSales: number;
}

export default async function AdminVendorsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  const multiVendorEnabled = await isMultiVendorEnabled();
  if (!multiVendorEnabled) notFound();

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={5} />}>
        <VendorsStats locale={locale} />
      </Suspense>

      <Suspense
        fallback={
          <AdminListSkeleton stats={0} columns={5} tabs={4} thumbnail />
        }
      >
        <VendorsTable locale={locale} searchParams={search} />
      </Suspense>
    </div>
  );
}

async function VendorsTable({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // Parsed with the schema the API route uses, so the page and the endpoint
  // can never read one query string two different ways.
  const query = parsePageQuery(searchParams, AdminListQuerySchema);
  const list = await fetchAdminVendorList(query);

  return (
    <VendorsDataTable
      locale={locale}
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

async function VendorsStats({ locale }: { locale: string }) {
  const [t, stats, formatCurrency] = await Promise.all([
    getTranslations({ locale }),
    getVendorsStats(),
    getStoreMoneyFormatter(),
  ]);

  const statItems: AdminStatsStripItem[] = [
    {
      title: t("admin.vendorsPage.stats.totalVendors.title"),
      value: stats.totalVendors,
      description: t("admin.vendorsPage.stats.totalVendors.description"),
      icon: <Store className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("admin.vendorsPage.stats.approvedVendors.title"),
      value: stats.approvedVendors,
      description: t("admin.vendorsPage.stats.approvedVendors.description"),
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("admin.vendorsPage.stats.pendingReview.title"),
      value: stats.pendingVendors,
      description: t("admin.vendorsPage.stats.pendingReview.description"),
      icon: <Clock3 className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: t("admin.vendorsPage.stats.flaggedVendors.title"),
      value: stats.flaggedVendors,
      description: t("admin.vendorsPage.stats.flaggedVendors.description"),
      icon: <CircleAlert className="h-5 w-5" />,
      iconClassName: "text-rose-700 bg-rose-100",
    },
    {
      title: t("admin.vendorsPage.stats.vendorSales.title"),
      value: formatCurrency(stats.totalSales),
      description: t("admin.vendorsPage.stats.vendorSales.description"),
      icon: <HandCoins className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
  ];

  return <AdminStatsStrip items={statItems} />;
}

async function getVendorsStats(): Promise<VendorsStats> {
  await connectDB();
  await syncDefaultVendorWithSettings();

  const [[result], externalVendors] = await Promise.all([
    Vendor.aggregate([
      { $match: getExternalVendorFilter() },
      {
        $facet: {
          totalVendors: [{ $count: "count" }],
          approvedVendors: [
            { $match: { status: VENDOR_STATUS.APPROVED } },
            { $count: "count" },
          ],
          pendingVendors: [
            { $match: { status: VENDOR_STATUS.PENDING } },
            { $count: "count" },
          ],
          flaggedVendors: [
            { $match: { status: { $in: [VENDOR_STATUS.SUSPENDED, VENDOR_STATUS.REJECTED] } } },
            { $count: "count" },
          ],
        },
      },
    ]),
    Vendor.find(getExternalVendorFilter()).select("_id").lean(),
  ]);

  // Lifetime gross sales come from orders, not the never-written
  // `Vendor.totalSales` column — same source as the per-row Sales column.
  const salesTotals = await getVendorSalesTotals(
    externalVendors.map((vendor) => String(vendor._id)),
  );
  let totalSales = 0;
  for (const amount of salesTotals.values()) totalSales += amount;

  return {
    totalVendors: result?.totalVendors?.[0]?.count ?? 0,
    approvedVendors: result?.approvedVendors?.[0]?.count ?? 0,
    pendingVendors: result?.pendingVendors?.[0]?.count ?? 0,
    flaggedVendors: result?.flaggedVendors?.[0]?.count ?? 0,
    totalSales,
  };
}
