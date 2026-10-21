import { setRequestLocale } from "next-intl/server";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { OrderCreateForm } from "@/components/common/order-create-form";
import { isPostcodeRequired } from "@/lib/shipping/address-verification";
import { getSettings } from "@/models/settings.model";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function StaffCreateOrderPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await requireStaffAreaAccess({
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
      variant="staff"
      canCreateCustomer={access.staffPermissions.includes(STAFF_PERMISSIONS.CREATE_CUSTOMERS) || access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_CUSTOMERS)}
      postalCodeRequired={postalCodeRequired}
    />
  );
}
