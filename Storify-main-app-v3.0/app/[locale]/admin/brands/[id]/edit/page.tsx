import { setRequestLocale } from "next-intl/server";
import { BrandForm } from "@/components/admin/brand-form";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditBrandPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return <BrandForm brandId={id} />;
}
