import { setRequestLocale } from "next-intl/server";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { staffResourceActions, staffResourcePermissions } from "@/lib/access/staff-resource-actions";
import { CategoriesListView } from "@/components/admin/categories-list-view";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function StaffCategoriesPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const access = await requireStaffAreaAccess({ locale, required: staffResourcePermissions("categories") });
  return <CategoriesListView area="staff" actionAccess={staffResourceActions(access.staffPermissions, "categories")} locale={locale} searchParams={searchParams} />;
}
