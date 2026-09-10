import { setRequestLocale } from "next-intl/server";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { OrderCreateForm } from "@/components/common/order-create-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminCreateOrderPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [
      STAFF_PERMISSIONS.CREATE_ORDERS,
      STAFF_PERMISSIONS.MANAGE_ORDERS,
    ],
  });

  return <OrderCreateForm locale={locale} variant="admin" />;
}
