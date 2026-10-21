import { setRequestLocale } from "next-intl/server";
import { CategoryForm } from "@/components/admin/category-form";
import { getSettingsLean } from "@/models/settings.model";
import { taxClassOptions } from "@/lib/tax/tax-settings";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewCategoryPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  // Settings → Tax's classes, for the category's tax picker.
  const taxClasses = taxClassOptions((await getSettingsLean()).tax);

  return <CategoryForm taxClasses={taxClasses} />;
}
