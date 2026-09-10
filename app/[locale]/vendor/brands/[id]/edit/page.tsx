import { setRequestLocale } from "next-intl/server";
import { BrandForm } from "@/components/admin/brand-form";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditVendorBrandPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.EDIT_BRANDS],
  });

  return <BrandForm brandId={id} apiBase="/api/vendor/brands" area="vendor" />;
}
