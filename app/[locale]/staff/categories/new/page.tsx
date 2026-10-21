import { setRequestLocale } from "next-intl/server";
import { CategoryForm } from "@/components/admin/category-form";
import { getSettingsLean } from "@/models/settings.model";
import { taxClassOptions } from "@/lib/tax/tax-settings";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewCategoryPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireStaffAreaAccess({ locale, required: [STAFF_PERMISSIONS.CREATE_CATEGORIES, STAFF_PERMISSIONS.MANAGE_CATEGORIES] });

  // Settings → Tax's classes, for the category's tax picker.
  const taxClasses = taxClassOptions((await getSettingsLean()).tax);

  return <CategoryForm area="staff" taxClasses={taxClasses} />;
}
