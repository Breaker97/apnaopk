import { setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { ProductsListView } from "@/components/admin/products-list-view";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function StaffProductsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_PRODUCTS],
  });
  const readOnly = !(
    access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_PRODUCTS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.CREATE_PRODUCTS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.EDIT_PRODUCTS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.DELETE_PRODUCTS)
  );
  const settings = await getSettings();

  return (
    <ProductsListView
      locale={locale}
      area="staff"
      readOnly={readOnly}
      staffScope={access.staffScope}
      isMultiVendor={Boolean(settings.multiVendorMode?.enabled)}
      searchParams={search}
    />
  );
}
