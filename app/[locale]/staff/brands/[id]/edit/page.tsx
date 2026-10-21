import { setRequestLocale } from "next-intl/server";
import { BrandForm } from "@/components/admin/brand-form";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditBrandPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireStaffAreaAccess({ locale, required: [STAFF_PERMISSIONS.EDIT_BRANDS, STAFF_PERMISSIONS.MANAGE_BRANDS] });

  return <BrandForm area="staff" brandId={id} />;
}
