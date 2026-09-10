import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { isMultiVendorEnabled } from "@/lib/vendors/multi-vendor";
import { VendorForm } from "@/components/admin/vendor-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewVendorPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  if (!(await isMultiVendorEnabled())) notFound();

  return <VendorForm locale={locale} />;
}
