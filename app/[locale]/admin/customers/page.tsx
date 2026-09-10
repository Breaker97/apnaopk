import { setRequestLocale } from "next-intl/server";
import { CustomersListView } from "@/components/admin/customers-list-view";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminCustomersPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_CUSTOMERS],
  });

  return (
    <CustomersListView
      locale={locale}
      area="admin"
      staffScope={access?.staffScope}
      searchParams={search}
    />
  );
}
