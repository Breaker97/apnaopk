import { setRequestLocale } from "next-intl/server";
import { CustomerForm } from "@/components/admin/customer-form";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function StaffNewCustomerPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireStaffAreaAccess({
    locale,
    required: [
      STAFF_PERMISSIONS.CREATE_CUSTOMERS,
      STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
    ],
  });

  return <CustomerForm locale={locale} area="staff" />;
}
