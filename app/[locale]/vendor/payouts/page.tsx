import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { VendorPayoutsContent } from "@/components/vendor/payouts/vendor-payouts-content";
import { serializeRows } from "@/lib/api/list-query";
import { fetchPayoutList, PAYOUTS_DEFAULT_PAGE_SIZE } from "@/lib/finance/payout-list";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VendorPayoutsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_PAYOUTS],
  });

  return (
    <Suspense
      fallback={
        <AdminListSkeleton stats={0} columns={5} tabs={5} thumbnail={false} />
      }
    >
      <PayoutsTable
        locale={locale}
        searchParams={search}
        vendorId={String(access.vendor._id)}
      />
    </Suspense>
  );
}

async function PayoutsTable({
  locale,
  searchParams,
  vendorId,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
  vendorId: string;
}) {
  const read = (key: string) =>
    typeof searchParams[key] === "string"
      ? (searchParams[key] as string)
      : undefined;

  const page = Number.parseInt(read("page") ?? "", 10);
  const limit = Number.parseInt(read("limit") ?? "", 10);

  const list = await fetchPayoutList(
    {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit:
        Number.isFinite(limit) && limit > 0
          ? Math.min(limit, 100)
          : PAYOUTS_DEFAULT_PAGE_SIZE,
      search: read("search"),
      status: read("status") ?? "all",
      sortBy: read("sortBy") ?? "createdAt",
      sortOrder: read("sortOrder") === "asc" ? "asc" : "desc",
    },
    { vendorId },
  );

  return (
    <VendorPayoutsContent
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
