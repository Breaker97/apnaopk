import { setRequestLocale } from "next-intl/server";
import { ProductForm } from "@/components/admin/product-form";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function StaffNewProductPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireStaffAreaAccess({
    locale,
    required: [
      STAFF_PERMISSIONS.CREATE_PRODUCTS,
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
    ],
  });

  return <ProductForm area="staff" />;
}
