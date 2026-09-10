import { setRequestLocale } from "next-intl/server";
import { CustomersListView } from "@/components/admin/customers-list-view";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function StaffCustomersPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_CUSTOMERS],
  });
  const readOnly = !(
    access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_CUSTOMERS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.CREATE_CUSTOMERS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.EDIT_CUSTOMERS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.DELETE_CUSTOMERS)
  );

  return (
    <CustomersListView
      locale={locale}
      area="staff"
      readOnly={readOnly}
      staffScope={access.staffScope}
      searchParams={search}
    />
  );
}
