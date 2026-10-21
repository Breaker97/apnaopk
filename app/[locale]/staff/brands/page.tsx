import { setRequestLocale } from "next-intl/server";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { staffResourceActions, staffResourcePermissions } from "@/lib/access/staff-resource-actions";
import { BrandsListView } from "@/components/admin/brands-list-view";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function StaffBrandsPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const access = await requireStaffAreaAccess({ locale, required: staffResourcePermissions("brands") });
  return <BrandsListView area="staff" actionAccess={staffResourceActions(access.staffPermissions, "brands")} locale={locale} searchParams={searchParams} />;
}
