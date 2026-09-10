import { Suspense } from "react";
import { BadgeCheck, Crown, HandCoins, UserRound, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  AdminStatsStrip,
  AdminStatsStripSkeleton,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { CustomersDataTable } from "@/components/admin/customers-data-table";
import { parsePageQuery } from "@/lib/api/validate";
import { serializeRows } from "@/lib/api/list-query";
import { CustomerListQuerySchema } from "@/lib/validations/list-query";
import {
  fetchAdminCustomerList,
  fetchAdminCustomerStats,
} from "@/lib/customers/customer-list";
import { getStoreMoneyFormatter } from "@/lib/intl/server-currency";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

type SearchParams = { [key: string]: string | string[] | undefined };

interface CustomersListViewProps {
  locale: string;
  area: "admin" | "staff";
  readOnly?: boolean;
  staffScope?: StaffAccessScope | null;
  searchParams: SearchParams;
}

/** The customers list route, shared by the admin and staff areas. */
export function CustomersListView({
  locale,
  area,
  readOnly,
  staffScope,
  searchParams,
}: CustomersListViewProps) {
  const query = parsePageQuery(searchParams, CustomerListQuerySchema);
  // The URL carries `tier` (what the filter control is called); the query
  // takes `loyaltyTier`. This is the one rename the old client hook did via
  // `mapQuery`, kept here so the URL stays the readable one.
  const tier =
    typeof searchParams.tier === "string" && searchParams.tier !== "all"
      ? searchParams.tier
      : undefined;

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={5} />}>
        <CustomersStats locale={locale} />
      </Suspense>

      <Suspense
        fallback={
          <AdminListSkeleton stats={0} columns={6} tabs={4} thumbnail />
        }
      >
        <CustomersTable
          locale={locale}
          area={area}
          readOnly={readOnly}
          staffScope={staffScope}
          query={{
            ...query,
            loyaltyTier: (tier ??
              query.loyaltyTier) as typeof query.loyaltyTier,
          }}
        />
      </Suspense>
    </div>
  );
}

async function CustomersTable({
  locale,
  area,
  readOnly,
  staffScope,
  query,
}: {
  locale: string;
  area: "admin" | "staff";
  readOnly?: boolean;
  staffScope?: StaffAccessScope | null;
  query: ReturnType<typeof parsePageQuery<typeof CustomerListQuerySchema>>;
}) {
  const list = await fetchAdminCustomerList(query, staffScope);

  return (
    <CustomersDataTable
      locale={locale}
      area={area}
      readOnly={readOnly}
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

async function CustomersStats({ locale }: { locale: string }) {
  const [t, stats, money] = await Promise.all([
    getTranslations({ locale }),
    fetchAdminCustomerStats(),
    getStoreMoneyFormatter(),
  ]);

  const items: AdminStatsStripItem[] = [
    {
      title: t("admin.customersPage.stats.totalCustomers.title"),
      value: stats.totalCustomers,
      description: t("admin.customersPage.stats.totalCustomers.description"),
      icon: <Users className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("admin.customersPage.stats.activeAccounts.title"),
      value: stats.activeCustomers,
      description: t("admin.customersPage.stats.activeAccounts.description"),
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("admin.customersPage.stats.vipCustomers.title"),
      value: stats.vipCustomers,
      description: t("admin.customersPage.stats.vipCustomers.description"),
      icon: <Crown className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: t("admin.customersPage.stats.customerSpend.title"),
      value: money(stats.totalSpend),
      description: t("admin.customersPage.stats.customerSpend.description"),
      icon: <HandCoins className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
    {
      title: t("admin.customersPage.stats.avgSpendPerCustomer.title"),
      value: money(stats.avgSpendPerCustomer),
      description: t(
        "admin.customersPage.stats.avgSpendPerCustomer.description",
      ),
      icon: <UserRound className="h-5 w-5" />,
      iconClassName: "text-cyan-700 bg-cyan-100",
    },
  ];

  return <AdminStatsStrip items={items} />;
}
