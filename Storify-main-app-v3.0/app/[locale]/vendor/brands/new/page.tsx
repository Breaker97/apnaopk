import { setRequestLocale } from "next-intl/server";
import { BrandForm } from "@/components/admin/brand-form";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewVendorBrandPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.CREATE_BRANDS],
  });

  return <BrandForm apiBase="/api/vendor/brands" area="vendor" />;
}
