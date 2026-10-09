import "server-only";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AdminStatsStripSkeleton } from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { AbandonedCheckoutsDataTable } from "@/components/admin/abandoned-checkouts-data-table";
import { AbandonedCheckoutStatsStrip } from "@/components/admin/abandoned-checkouts-stats-strip";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { staffScopeReachesAbandonedCheckouts } from "@/lib/access/staff-scope";
import { serializeRows } from "@/lib/api/list-query";
import { localeHref } from "@/lib/i18n/locale-routing";
import {
  fetchAbandonedCheckoutList,
  type AbandonedCheckoutViewer,
} from "@/lib/orders/abandoned-checkout-list";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Staff → Abandoned checkouts: the store's list, for a staff member granted
 * `view_abandoned_checkouts`, narrowed to their scope — limited to vendors,
 * the checkouts holding one of those vendors' goods; to regions, those
 * shipping there. A staff member limited by locations alone is turned away:
 * a checkout has no location to match. Recovery emails and links need
 * `manage_abandoned_checkouts`; export and detection stay with the store.
 */
export default async function StaffAbandonedCheckoutsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ABANDONED_CHECKOUTS],
  });
  if (!staffScopeReachesAbandonedCheckouts(access.staffScope)) {
    redirect(await localeHref(locale, "/forbidden"));
  }
  const viewer: AbandonedCheckoutViewer = { kind: "staff", scope: access.staffScope };
  const canManage = access.staffPermissions.includes(
    STAFF_PERMISSIONS.MANAGE_ABANDONED_CHECKOUTS,
  );

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={5} />}>
        <AbandonedCheckoutStatsStrip locale={locale} viewer={viewer} />
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
        <StaffAbandonedCheckoutsTable
          locale={locale}
          searchParams={search}
          viewer={viewer}
          canManage={canManage}
        />
      </Suspense>
    </div>
  );
}

async function StaffAbandonedCheckoutsTable({
  locale,
  searchParams,
  viewer,
  canManage,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
  viewer: AbandonedCheckoutViewer;
  canManage: boolean;
}) {
  // The API route's own parser, through the same URLSearchParams.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  if (!params.get("limit")) params.set("limit", String(DEFAULT_PAGE_SIZE));

  const list = await fetchAbandonedCheckoutList(params, viewer);

  return (
    <AbandonedCheckoutsDataTable
      locale={locale}
      area="staff"
      canManage={canManage}
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
