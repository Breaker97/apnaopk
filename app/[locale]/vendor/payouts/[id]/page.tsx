import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { VendorPayoutDetails } from "@/components/vendor/payouts/vendor-payout-details";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function VendorPayoutDetailsPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_PAYOUTS],
  });

  return <VendorPayoutDetails locale={locale} payoutId={id} />;
}
