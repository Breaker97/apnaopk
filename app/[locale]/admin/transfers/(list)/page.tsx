import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { TransfersList } from "@/components/admin/transfers/transfers-list";
import {
  fetchTransferList,
  TRANSFERS_DEFAULT_PAGE_SIZE,
} from "@/lib/inventory/transfer-list";
import { serializeRows } from "@/lib/api/list-query";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminTransfersPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_INVENTORY],
  });

  return (
    <Suspense
      fallback={
        <AdminListSkeleton
          stats={0}
          columns={6}
          tabs={6}
          thumbnail={false}
          toolbarAction={false}
        />
      }
    >
      <TransfersTable locale={locale} searchParams={search} />
    </Suspense>
  );
}

async function TransfersTable({
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
  if (!params.get("limit")) {
    params.set("limit", String(TRANSFERS_DEFAULT_PAGE_SIZE));
  }

  const list = await fetchTransferList(params);

  return (
    <TransfersList
      locale={locale}
      data={serializeRows(list.items)}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
      counters={list.counters}
    />
  );
}
