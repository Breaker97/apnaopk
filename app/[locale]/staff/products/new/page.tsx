import { setRequestLocale } from "next-intl/server";
import { ProductForm } from "@/components/admin/product-form";
import { resolveProductFeatures } from "@/lib/products/product-features";
import { getSettingsLean } from "@/models/settings.model";
import { taxClassOptions, vendorTaxLock } from "@/lib/tax/tax-settings";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function StaffNewProductPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await requireStaffAreaAccess({
    locale,
    required: [
      STAFF_PERMISSIONS.CREATE_PRODUCTS,
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
    ],
  });

  // Settings → Products decides which formats, pre-orders and quotes the
  // editor offers; read here so the form is right on its first paint.
  const settings = await getSettingsLean();
  const productFeatures = resolveProductFeatures(settings);
  // Staff a vendor created work under the vendors' tax rule, and leave asking
  // for a change to the vendor (lib/tax/vendor-tax.ts).
  const taxLock = access.staffScope?.wholeOrdersOnly && vendorTaxLock(settings.tax) ? "never" : undefined;

  return <ProductForm area="staff" productFeatures={productFeatures} taxClasses={taxClassOptions(settings.tax)} taxLock={taxLock} />;
}
