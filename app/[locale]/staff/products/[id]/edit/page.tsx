import { staffResourceActions } from "@/lib/access/staff-resource-actions";
import { ProductForm } from "@/components/admin/product-form";
import { resolveProductFeatures } from "@/lib/products/product-features";
import { getSettingsLean } from "@/models/settings.model";
import { taxClassOptions, vendorTaxLock } from "@/lib/tax/tax-settings";
import { setRequestLocale } from "next-intl/server";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function StaffEditProductPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.EDIT_PRODUCTS, STAFF_PERMISSIONS.MANAGE_PRODUCTS],
  });

  // Settings → Products decides which formats, pre-orders and quotes the
  // editor offers; read here so the form is right on its first paint.
  const settings = await getSettingsLean();
  const productFeatures = resolveProductFeatures(settings);
  // Staff a vendor created work under the vendors' tax rule, and leave asking
  // for a change to the vendor (lib/tax/vendor-tax.ts).
  const taxLock = access.staffScope?.wholeOrdersOnly && vendorTaxLock(settings.tax) ? "never" : undefined;

  return <ProductForm productId={id} area="staff" canDelete={staffResourceActions(access.staffPermissions, "products").canDelete} productFeatures={productFeatures} taxClasses={taxClassOptions(settings.tax)} taxLock={taxLock} />;
}
