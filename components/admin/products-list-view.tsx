import { Suspense } from "react";
import {
  Archive,
  BadgeCheck,
  Boxes,
  PackageSearch,
  Warehouse,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  AdminStatsStrip,
  AdminStatsStripSkeleton,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { ProductsDataTable } from "@/components/admin/products-data-table";
import { parsePageQuery } from "@/lib/api/validate";
import { serializeRows } from "@/lib/api/list-query";
import { ProductListQuerySchema } from "@/lib/validations/list-query";
import {
  fetchAdminProductList,
  fetchAdminProductStats,
} from "@/lib/catalog/product-list";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

type SearchParams = { [key: string]: string | string[] | undefined };

interface ProductsListViewProps {
  locale: string;
  area: "admin" | "staff";
  readOnly?: boolean;
  staffScope?: StaffAccessScope | null;
  isMultiVendor?: boolean;
  searchParams: SearchParams;
}

/**
 * The products list route, shared by the admin and staff areas.
 *
 * The query string is the whole state of this screen: the table navigates
 * rather than fetching, which re-runs this component with the new params.
 * Neither half is awaited by the page, so the shell ships as soon as the
 * access check clears and the table and the stats strip stream in
 * independently.
 */
export function ProductsListView({
  locale,
  area,
  readOnly,
  staffScope,
  isMultiVendor = false,
  searchParams,
}: ProductsListViewProps) {
  // Parsed with the same schema the API route uses, so the page and the
  // endpoint can never read one query string two different ways.
  const query = parsePageQuery(searchParams, ProductListQuerySchema);

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={5} />}>
        <ProductsStats locale={locale} staffScope={staffScope} />
      </Suspense>

      <Suspense
        fallback={
          <AdminListSkeleton stats={0} columns={6} tabs={4} thumbnail />
        }
      >
        <ProductsTable
          locale={locale}
          area={area}
          readOnly={readOnly}
          staffScope={staffScope}
          isMultiVendor={isMultiVendor}
          query={query}
        />
      </Suspense>
    </div>
  );
}

async function ProductsTable({
  locale,
  area,
  readOnly,
  staffScope,
  isMultiVendor,
  query,
}: {
  locale: string;
  area: "admin" | "staff";
  readOnly?: boolean;
  staffScope?: StaffAccessScope | null;
  isMultiVendor: boolean;
  query: ReturnType<typeof parsePageQuery<typeof ProductListQuerySchema>>;
}) {
  const list = await fetchAdminProductList(query, { staffScope, isMultiVendor });

  return (
    <ProductsDataTable
      locale={locale}
      area={area}
      readOnly={readOnly}
      isMultiVendor={isMultiVendor}
      data={serializeRows(list.items)}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
      vendorOptions={list.vendorOptions}
    />
  );
}

async function ProductsStats({
  locale,
  staffScope,
}: {
  locale: string;
  staffScope?: StaffAccessScope | null;
}) {
  const [t, stats] = await Promise.all([
    getTranslations({ locale }),
    fetchAdminProductStats(staffScope),
  ]);

  const items: AdminStatsStripItem[] = [
    {
      title: t("admin.productsPage.stats.totalProducts.title"),
      value: stats.totalProducts,
      description: t("admin.productsPage.stats.totalProducts.description"),
      icon: <Boxes className="h-5 w-5" />,
      iconClassName: "text-teal-700 bg-teal-100",
    },
    {
      title: t("admin.productsPage.stats.activeListings.title"),
      value: stats.activeProducts,
      description: t("admin.productsPage.stats.activeListings.description"),
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("admin.productsPage.stats.draftProducts.title"),
      value: stats.draftProducts,
      description: t("admin.productsPage.stats.draftProducts.description"),
      icon: <Archive className="h-5 w-5" />,
      iconClassName: "text-indigo-700 bg-indigo-100",
    },
    {
      title: t("admin.productsPage.stats.outOfStock.title"),
      value: stats.outOfStockProducts,
      description: t("admin.productsPage.stats.outOfStock.description"),
      icon: <PackageSearch className="h-5 w-5" />,
      iconClassName: "text-orange-700 bg-orange-100",
    },
    {
      title: t("admin.productsPage.stats.inventoryUnits.title"),
      value: stats.totalInventoryUnits,
      description: t("admin.productsPage.stats.inventoryUnits.description"),
      icon: <Warehouse className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
  ];

  return <AdminStatsStrip items={items} />;
}
