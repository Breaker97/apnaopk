import { setRequestLocale } from "next-intl/server";
import { CustomersListView } from "@/components/admin/customers-list-view";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { USER_ROLES } from "@/config/app.config";

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

  // Password resets and account invites reach the shopper's login, so they
  // ask for what an edit of the customer does.
  const canSendAccountEmail =
    access.session.user.role === USER_ROLES.ADMIN ||
    access.staffPermissions?.includes(STAFF_PERMISSIONS.MANAGE_CUSTOMERS) ||
    access.staffPermissions?.includes(STAFF_PERMISSIONS.EDIT_CUSTOMERS) ||
    false;

  return (
    <CustomersListView
      locale={locale}
      area="admin"
      canSendAccountEmail={canSendAccountEmail}
      staffScope={access?.staffScope}
      searchParams={search}
    />
  );
}
