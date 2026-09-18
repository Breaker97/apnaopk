import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { TransferCreateForm } from "@/components/admin/transfers/transfer-create-form";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function VendorTransferCreatePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireVendorAreaAccess({
    locale,
    required: [
      VENDOR_PERMISSIONS.MANAGE_PRODUCTS,
      VENDOR_PERMISSIONS.EDIT_PRODUCTS,
    ],
  });

  return <TransferCreateForm locale={locale} area="vendor" />;
}
