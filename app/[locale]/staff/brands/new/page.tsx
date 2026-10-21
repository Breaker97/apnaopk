import { setRequestLocale } from "next-intl/server";
import { BrandForm } from "@/components/admin/brand-form";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewBrandPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireStaffAreaAccess({ locale, required: [STAFF_PERMISSIONS.CREATE_BRANDS, STAFF_PERMISSIONS.MANAGE_BRANDS] });

  return <BrandForm area="staff" />;
}
