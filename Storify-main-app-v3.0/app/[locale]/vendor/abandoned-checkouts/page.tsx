import "server-only";
import { Suspense, type ComponentProps } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AdminStatsStripSkeleton } from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { AbandonedCheckoutsDataTable } from "@/components/admin/abandoned-checkouts-data-table";
import { VendorAbandonedCheckoutStatsStrip } from "@/components/admin/abandoned-checkouts-stats-strip";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { serializeRows } from "@/lib/api/list-query";
import { connectDB } from "@/lib/db";
import { fetchAbandonedCheckoutList } from "@/lib/orders/abandoned-checkout-list";
import {
  requireVendorAbandonedCheckoutViewer,
  vendorsSeeAbandonedCheckouts,
} from "@/lib/orders/vendor-abandoned-checkout-access";
import { getSettings } from "@/models/settings.model";
import { abandonedOfferPolicy } from "@/lib/orders/abandoned-offer-state";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Vendor → Orders → Abandoned checkouts: the checkouts that held this vendor's
 * products and were left before payment, drawn by the store's own table.
 *
 * Everything here is this vendor's alone, chosen by the signed-in account, and
 * cut down on the server before it reaches the page: only its own lines, its
 * own share of the money, and no shopper named. It only reads — the recovery
 * emails are the store's. Gated on viewing orders, as the vendor's Quotes are,
 * and on the store's switch (Vendors → Configuration → Abandoned checkouts).
 */
export default async function VendorAbandonedCheckoutsPage({
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
  await connectDB();
  const settings = await getSettings();
  if (!vendorsSeeAbandonedCheckouts(settings)) notFound();
  const viewer = await requireVendorAbandonedCheckoutViewer(access.session.user.id);

  // Offers: shown where the store allows them; sendable by a vendor that may
  // make discounts, since each one spends the vendor's own money.
  const policy = abandonedOfferPolicy(settings);
  const offers = policy.enabled
    ? {
        canSend: Boolean(access.access?.has(VENDOR_PERMISSIONS.CREATE_DISCOUNTS)),
        automatic: policy.automatic,
        limits: { maxPercent: policy.maxPercent, maxValidDays: policy.maxValidDays },
      }
    : undefined;

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={4} />}>
        <VendorAbandonedCheckoutStatsStrip locale={locale} vendorId={viewer.vendorId} />
      </Suspense>

      <Suspense
        fallback={
          <AdminListSkeleton
            stats={0}
            columns={4}
            tabs={3}
            thumbnail={false}
            headerActions={0}
          />
        }
      >
        <VendorAbandonedCheckoutsTable
          locale={locale}
          searchParams={search}
          vendorId={viewer.vendorId}
          offers={offers}
        />
      </Suspense>
    </div>
  );
}

async function VendorAbandonedCheckoutsTable({
  locale,
  searchParams,
  vendorId,
  offers,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
  vendorId: string;
  offers?: ComponentProps<typeof AbandonedCheckoutsDataTable>["offers"];
}) {
  // The API route's own parser, through the same URLSearchParams.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  if (!params.get("limit")) params.set("limit", String(DEFAULT_PAGE_SIZE));

  const list = await fetchAbandonedCheckoutList(params, { kind: "vendor", vendorId });

  return (
    <AbandonedCheckoutsDataTable
      locale={locale}
      area="vendor"
      offers={offers}
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
