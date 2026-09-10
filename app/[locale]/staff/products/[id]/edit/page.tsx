import { ProductForm } from "@/components/admin/product-form";
import { setRequestLocale } from "next-intl/server";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function StaffEditProductPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.EDIT_PRODUCTS, STAFF_PERMISSIONS.MANAGE_PRODUCTS],
  });

  return <ProductForm productId={id} area="staff" />;
}
