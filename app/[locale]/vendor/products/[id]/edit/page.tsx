import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { ProductForm } from "@/components/admin/product-form";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function VendorEditProductPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.EDIT_PRODUCTS, VENDOR_PERMISSIONS.MANAGE_PRODUCTS],
  });

  return (
    <ProductForm productId={id} isVendor />
  );
}
