import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { PaymentTransactionsTable } from "@/components/admin/payments/payment-transactions-table";
import { serializeRows } from "@/lib/api/list-query";
import {
  fetchPaymentTransactionList,
  TRANSACTIONS_DEFAULT_PAGE_SIZE,
} from "@/lib/payments/payment-transaction-list";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminPaymentTransactionsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  return (
    <Suspense
      fallback={
        <AdminListSkeleton stats={0} columns={6} tabs={5} thumbnail={false} />
      }
    >
      <TransactionsTable locale={locale} searchParams={search} />
    </Suspense>
  );
}

async function TransactionsTable({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const read = (key: string) =>
    typeof searchParams[key] === "string"
      ? (searchParams[key] as string)
      : undefined;

  const page = Number.parseInt(read("page") ?? "", 10);
  const limit = Number.parseInt(read("limit") ?? "", 10);

  const list = await fetchPaymentTransactionList({
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit:
      Number.isFinite(limit) && limit > 0
        ? Math.min(limit, 100)
        : TRANSACTIONS_DEFAULT_PAGE_SIZE,
    search: read("search"),
    status: read("status"),
    type: read("type"),
    provider: read("provider"),
    sortBy: read("sortBy"),
    sortOrder: read("sortOrder") === "asc" ? "asc" : "desc",
  });

  return (
    <PaymentTransactionsTable
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
