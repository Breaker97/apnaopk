import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { VendorOrderDetails } from "@/components/vendor/order-details";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function VendorOrderDetailsPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_ORDERS],
  });
  const canEditOrder =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_ORDERS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.EDIT_ORDERS);
  const canDeleteOrder =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_ORDERS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.DELETE_ORDERS);

  return (
    <VendorOrderDetails
      orderId={id}
      locale={locale}
      canEditOrder={canEditOrder}
      canDeleteOrder={canDeleteOrder}
    />
  );
}
