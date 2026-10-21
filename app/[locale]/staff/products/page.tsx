import { staffResourceActions, staffResourcePermissions } from "@/lib/access/staff-resource-actions";
import { setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { ProductsListView } from "@/components/admin/products-list-view";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";

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
    required: staffResourcePermissions("products"),
  });
  const actionAccess = staffResourceActions(access.staffPermissions, "products");
  const settings = await getSettings();

  return (
    <ProductsListView
      locale={locale}
      area="staff"
      actionAccess={actionAccess}
      staffScope={access.staffScope}
      isMultiVendor={Boolean(settings.multiVendorMode?.enabled)}
      searchParams={search}
    />
  );
}
