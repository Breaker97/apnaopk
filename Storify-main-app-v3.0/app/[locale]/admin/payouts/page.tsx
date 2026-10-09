import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { AdminPayoutsContent } from "@/components/admin/payouts/admin-payouts-content";
import { isMultiVendorEnabled } from "@/lib/vendors/multi-vendor";
import { serializeRows } from "@/lib/api/list-query";
import { fetchPayoutList, PAYOUTS_DEFAULT_PAGE_SIZE } from "@/lib/finance/payout-list";
import { fetchAdminVendorList } from "@/lib/vendors/vendor-list";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminPayoutsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  if (!(await isMultiVendorEnabled())) notFound();

  return (
    <Suspense
      fallback={
        <AdminListSkeleton stats={0} columns={6} tabs={5} thumbnail={false} />
      }
    >
      <PayoutsTable locale={locale} searchParams={search} />
    </Suspense>
  );
}

async function PayoutsTable({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // The vendor filter and the create-payout form both need the vendor list;
  // fetched alongside the payouts rather than on mount from the client.
  const [list, vendors] = await Promise.all([
    fetchPayoutList(parsePayoutQuery(searchParams)),
    fetchAdminVendorList({ page: 1, limit: 100 }),
  ]);

  return (
    <AdminPayoutsContent
      locale={locale}
      vendorOptions={serializeRows(vendors.items)}
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

function parsePayoutQuery(searchParams: {
  [key: string]: string | string[] | undefined;
}) {
  const read = (key: string) =>
    typeof searchParams[key] === "string"
      ? (searchParams[key] as string)
      : undefined;

  const page = Number.parseInt(read("page") ?? "", 10);
  const limit = Number.parseInt(read("limit") ?? "", 10);

  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit:
      Number.isFinite(limit) && limit > 0
        ? Math.min(limit, 100)
        : PAYOUTS_DEFAULT_PAGE_SIZE,
    search: read("search"),
    status: read("status") ?? "all",
    vendorId: read("vendorId"),
    sortBy: read("sortBy") ?? "createdAt",
    sortOrder: read("sortOrder") === "asc" ? ("asc" as const) : ("desc" as const),
  };
}
