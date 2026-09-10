import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { OrderCreateForm } from "@/components/common/order-create-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function VendorCreateOrderPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await requireVendorAreaAccess({
    locale,
    required: [
      VENDOR_PERMISSIONS.CREATE_ORDERS,
      VENDOR_PERMISSIONS.MANAGE_ORDERS,
    ],
  });
  await requireApprovedVendorByUserId(access.session.user.id);

  return <OrderCreateForm locale={locale} variant="vendor" />;
}
