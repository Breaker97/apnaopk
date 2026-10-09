import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AdminStatsStripSkeleton } from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { QuotesDataTable } from "@/components/admin/quotes/quotes-data-table";
import { QuotesStatsStrip } from "@/components/admin/quotes/quotes-stats-strip";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { fetchVendorQuoteList, type VendorQuoteView } from "@/lib/quotes/quotes";
import { requireVendorQuoteView } from "@/lib/quotes/vendor-quote-access";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Vendor → Orders → Quotes: the requests for a price on this vendor's own
 * products, laid out as the store's Quotes page is and drawn by the same
 * table.
 *
 * Everything here is this vendor's alone, chosen by the signed-in account:
 * the list, the counts and the sheet read through the vendor readers in
 * lib/quotes/quotes.ts, which take the vendor as a required argument. The
 * store's price is final, so a quote the store has taken over is read-only
 * here; and when the store hides shoppers' contact details from vendors, they
 * are missing from every row rather than masked on screen.
 */
export default async function VendorQuotesPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_ORDERS],
  });
  const view = await requireVendorQuoteView(access.session.user.id);
  // The same grant that changes the vendor's orders answers its quotes.
  const canManage =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_ORDERS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.EDIT_ORDERS);

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={4} />}>
        <QuotesStatsStrip locale={locale} vendorId={String(view.vendorId)} />
      </Suspense>

      {/* Unkeyed, as on the store's page: a keyed boundary would unmount the
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
        <VendorQuotesTable searchParams={search} view={view} canManage={canManage} />
      </Suspense>
    </div>
  );
}

async function VendorQuotesTable({
  searchParams,
  view,
  canManage,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
  view: VendorQuoteView;
  canManage: boolean;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }

  const list = await fetchVendorQuoteList(params, view);

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
      scope="vendor"
    />
  );
}
