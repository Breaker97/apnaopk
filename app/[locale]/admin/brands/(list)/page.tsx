import { Suspense } from "react";
import { BadgeCheck, Ban, Clock, Star, Tag } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import {
  AdminStatsStrip,
  AdminStatsStripSkeleton,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { BrandsDataTable } from "@/components/admin/brands-data-table";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { fetchBrandList, fetchBrandStats } from "@/lib/catalog/brand-list";
import { serializeRows } from "@/lib/api/list-query";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const DEFAULT_PAGE_SIZE = 10;

export default async function AdminBrandsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={5} />}>
        <BrandsStats />
      </Suspense>

      <Suspense
        fallback={<AdminListSkeleton stats={0} columns={5} tabs={5} thumbnail />}
      >
        <BrandsTable locale={locale} searchParams={search} />
      </Suspense>
    </div>
  );
}

async function BrandsTable({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // Rebuilt as URLSearchParams so the page reads the query string through the
  // very same parser `/api/brands` uses.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  if (!params.get("page")) params.set("page", "1");
  if (!params.get("limit")) params.set("limit", String(DEFAULT_PAGE_SIZE));

  const list = await fetchBrandList(params, { isAdmin: true });

  return (
    <BrandsDataTable
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

async function BrandsStats() {
  const stats = await fetchBrandStats();

  const items: AdminStatsStripItem[] = [
    {
      title: "Total brands",
      value: stats.totalBrands,
      description: "All brands in your catalog",
      icon: <Tag className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: "Active brands",
      value: stats.activeBrands,
      description: "Visible on the storefront",
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: "Inactive brands",
      value: stats.inactiveBrands,
      description: "Hidden from the storefront",
      icon: <Ban className="h-5 w-5" />,
      iconClassName: "text-rose-700 bg-rose-100",
    },
    {
      title: "Pending approval",
      value: stats.pendingBrands,
      description: "Vendor brands awaiting review",
      icon: <Clock className="h-5 w-5" />,
      iconClassName: "text-orange-700 bg-orange-100",
    },
    {
      title: "Featured brands",
      value: stats.featuredBrands,
      description: "Highlighted on the storefront",
      icon: <Star className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
  ];

  return <AdminStatsStrip items={items} />;
}
