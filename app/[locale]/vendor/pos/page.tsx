import { connectDB } from "@/lib/db";
import { canAccessPOS } from "@/lib/access/rbac";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { POSPageShell } from "@/components/pos/pos-page-shell";
import {
  buildPOSSettings,
  vendorReceiptIdentity,
} from "@/lib/pos/build-pos-settings";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { Vendor } from "@/models";
import type { Address } from "@/types";
import type { VendorStoreVisibility } from "@/lib/vendors/vendor-address";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function VendorPosPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session } = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.ACCESS_POS],
  });

  await connectDB();
  const settings = await getSettings();
  if (!settings.pos?.enabled) {
    redirect(`/${locale}/vendor/dashboard`);
  }
  if (!(await canAccessPOS(session.user))) {
    redirect(`/${locale}/vendor/dashboard`);
  }

  // The receipt must print THIS vendor's store identity, not the platform's
  // `settings.general` header every other terminal shares.
  const vendor = await Vendor.findOne({ userId: session.user.id })
    .select("storeName address storeVisibility")
    .lean<{
      storeName?: string;
      address?: Address;
      storeVisibility?: VendorStoreVisibility;
    } | null>();

  // The shell streams a skeleton while it resolves the product list, so the
  // page never waits on the catalogue query before painting.
  return (
    <POSPageShell
      settings={buildPOSSettings(
        settings,
        vendor ? vendorReceiptIdentity(vendor) : undefined,
      )}
      user={session.user}
    />
  );
}
