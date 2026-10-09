import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { ProductForm } from "@/components/admin/product-form";
import { resolveProductFeatures } from "@/lib/products/product-features";
import { getSettingsLean } from "@/models/settings.model";

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

  // Settings → Products decides which formats, pre-orders and quotes the
  // editor offers; read here so the form is right on its first paint.
  const productFeatures = resolveProductFeatures(await getSettingsLean());

  return <ProductForm isVendor productFeatures={productFeatures} />;
}
