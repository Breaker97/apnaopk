import { staffResourceActions, staffResourcePermissions } from "@/lib/access/staff-resource-actions";
import { setRequestLocale } from "next-intl/server";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { OrdersListView } from "@/components/admin/orders-list-view";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function StaffOrdersPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireStaffAreaAccess({
    locale,
    required: staffResourcePermissions("orders"),
  });
  const actionAccess = staffResourceActions(access.staffPermissions, "orders");

  return (
    <OrdersListView
      locale={locale}
      area="staff"
      actionAccess={actionAccess}
      staffScope={access.staffScope}
      searchParams={search}
    />
  );
}
