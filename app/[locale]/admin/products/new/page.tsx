import { setRequestLocale } from "next-intl/server";
import { ProductForm } from "@/components/admin/product-form";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewProductPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [
      STAFF_PERMISSIONS.CREATE_PRODUCTS,
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
    ],
  });

  return <ProductForm />;
}
