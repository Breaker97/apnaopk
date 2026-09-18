import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { TransferDetails } from "@/components/admin/transfers/transfer-details";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function VendorTransferDetailsPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_PRODUCTS],
  });

  return <TransferDetails locale={locale} transferId={id} area="vendor" />;
}
