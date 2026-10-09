import { setRequestLocale } from "next-intl/server";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { OrderCreateForm } from "@/components/common/order-create-form";
import { isPostcodeRequired } from "@/lib/shipping/address-verification";
import { getSettings } from "@/models/settings.model";

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

  const postalCodeRequired = await isPostcodeRequired(await getSettings());

  return (
    <OrderCreateForm
      locale={locale}
      variant="admin"
      postalCodeRequired={postalCodeRequired}
    />
  );
}
