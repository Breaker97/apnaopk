import { setRequestLocale } from "next-intl/server";
import { ProductForm } from "@/components/admin/product-form";
import { resolveProductFeatures } from "@/lib/products/product-features";
import { getSettingsLean } from "@/models/settings.model";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditProductPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [
      STAFF_PERMISSIONS.EDIT_PRODUCTS,
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
    ],
  });

  // Settings → Products decides which formats, pre-orders and quotes the
  // editor offers; read here so the form is right on its first paint.
  const productFeatures = resolveProductFeatures(await getSettingsLean());

  return <ProductForm productId={id} productFeatures={productFeatures} />;
}
