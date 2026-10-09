import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AdminStatsStripSkeleton } from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { QuotesDataTable } from "@/components/admin/quotes/quotes-data-table";
import { QuotesStatsStrip } from "@/components/admin/quotes/quotes-stats-strip";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { fetchAdminQuoteList } from "@/lib/quotes/quotes";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Admin → Orders → Quotes.
 *
 * Laid out like the Orders list: the counts stream in above, the table
 * below, each in its own Suspense boundary so neither waits on the other. The
 * query string is the table's whole state — every tab, filter and page is a
 * navigation that re-runs `fetchAdminQuoteList` here.
 */
export default async function AdminQuotesPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ORDERS],
  });
  // Admins carry no staff permission list; staff need the manage grant to
  // answer, withdraw, close or delete — the routes behind those buttons check
  // the same thing.
  const canManage =
    !access.staffPermissions ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_ORDERS);

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={4} />}>
        <QuotesStatsStrip locale={locale} staffScope={access.staffScope} />
      </Suspense>

      {/* Unkeyed, as on the Orders page: a keyed boundary would unmount the
          table on every navigation and drop an open sheet or dialog with it. */}
      <Suspense
        fallback={
          <AdminListSkeleton
            stats={0}
            columns={5}
            tabs={6}
            rowActions
            headerActions={0}
          />
        }
      >
        <QuotesTable
          searchParams={search}
          staffScope={access.staffScope}
          canManage={canManage}
        />
      </Suspense>
    </div>
  );
}

async function QuotesTable({
  searchParams,
  staffScope,
  canManage,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
  staffScope?: StaffAccessScope | null;
  canManage: boolean;
}) {
  // Rebuilt as URLSearchParams so the page reads the query string through the
  // very same parser the API route uses.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }

  const list = await fetchAdminQuoteList(params, { staffScope });

  return (
    <QuotesDataTable
      data={list.items}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
      canManage={canManage}
    />
  );
}
