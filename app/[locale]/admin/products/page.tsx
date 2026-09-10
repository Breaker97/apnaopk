import { setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { ProductsListView } from "@/components/admin/products-list-view";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminProductsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_PRODUCTS],
  });
  const settings = await getSettings();

  return (
    <ProductsListView
      locale={locale}
      area="admin"
      staffScope={access?.staffScope}
      isMultiVendor={Boolean(settings.multiVendorMode?.enabled)}
      searchParams={search}
    />
  );
}
