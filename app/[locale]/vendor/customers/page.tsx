import { Suspense } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { CustomersDataTable } from "@/components/admin/customers-data-table";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { serializeRows } from "@/lib/api/list-query";
import { parsePageQuery } from "@/lib/api/validate";
import { fetchVendorCustomerList } from "@/lib/customers/customer-list";
import { CustomerListQuerySchema } from "@/lib/validations";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * The vendor's customer list: everyone — registered or guest — who has
 * ordered this vendor's items, with stats scoped to those orders. Gated on
 * order-viewing permissions because it is derived entirely from orders the
 * vendor can already see.
 */
export default async function VendorCustomersPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireVendorAreaAccess({
    locale,
    required: [
      VENDOR_PERMISSIONS.VIEW_ORDERS,
      VENDOR_PERMISSIONS.CREATE_ORDERS,
      VENDOR_PERMISSIONS.MANAGE_ORDERS,
    ],
  });

  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) notFound();

  const vendor = await requireApprovedVendorByUserId(access.session.user.id);
  const query = parsePageQuery(search, CustomerListQuerySchema);

  return (
    <Suspense
      fallback={<AdminListSkeleton stats={0} columns={5} tabs={5} thumbnail />}
    >
      <VendorCustomersTable
        locale={locale}
        vendorId={String(vendor._id)}
        query={query}
      />
    </Suspense>
  );
}

async function VendorCustomersTable({
  locale,
  vendorId,
  query,
}: {
  locale: string;
  vendorId: string;
  query: ReturnType<typeof parsePageQuery<typeof CustomerListQuerySchema>>;
}) {
  const list = await fetchVendorCustomerList(vendorId, query);

  return (
    <CustomersDataTable
      locale={locale}
      area="vendor"
      readOnly
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
