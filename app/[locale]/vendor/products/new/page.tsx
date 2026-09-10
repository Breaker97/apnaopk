import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { ProductForm } from "@/components/admin/product-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function VendorNewProductPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.CREATE_PRODUCTS, VENDOR_PERMISSIONS.MANAGE_PRODUCTS],
  });

  return (
    <ProductForm isVendor />
  );
}
