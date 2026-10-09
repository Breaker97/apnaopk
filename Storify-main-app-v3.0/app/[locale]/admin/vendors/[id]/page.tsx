import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { isMultiVendorEnabled } from "@/lib/vendors/multi-vendor";
import { VendorDetailShell } from "@/components/admin/vendors/vendor-detail-shell";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function VendorDetailsPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  if (!(await isMultiVendorEnabled())) notFound();

  return <VendorDetailShell locale={locale} vendorId={id} />;
}
