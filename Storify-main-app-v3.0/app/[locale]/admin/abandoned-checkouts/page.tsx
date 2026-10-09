import "server-only";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AdminStatsStripSkeleton } from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { AbandonedCheckoutsDataTable } from "@/components/admin/abandoned-checkouts-data-table";
import { AbandonedCheckoutStatsStrip } from "@/components/admin/abandoned-checkouts-stats-strip";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { fetchAbandonedCheckoutList } from "@/lib/orders/abandoned-checkout-list";
import { serializeRows } from "@/lib/api/list-query";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const DEFAULT_PAGE_SIZE = 10;

export default async function AdminAbandonedCheckoutsPage({
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
        <AbandonedCheckoutStatsStrip locale={locale} />
      </Suspense>

      <Suspense
        fallback={
          <AdminListSkeleton
            stats={0}
            columns={6}
            tabs={3}
            thumbnail={false}
            headerActions={0}
          />
        }
      >
        <AbandonedCheckoutsTable locale={locale} searchParams={search} />
      </Suspense>
    </div>
  );
}

async function AbandonedCheckoutsTable({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // Rebuilt as URLSearchParams so the page reads the query string through the
  // very same parser the API route uses.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  if (!params.get("limit")) params.set("limit", String(DEFAULT_PAGE_SIZE));

  const list = await fetchAbandonedCheckoutList(params);

  return (
    <AbandonedCheckoutsDataTable
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
