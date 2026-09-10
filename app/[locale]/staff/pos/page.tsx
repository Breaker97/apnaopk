import { connectDB } from "@/lib/db";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getSettings } from "@/models/settings.model";
import { POSPageShell } from "@/components/pos/pos-page-shell";
import {
  buildPOSSettings,
  vendorReceiptIdentity,
  type POSReceiptIdentity,
} from "@/lib/pos/build-pos-settings";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { Vendor } from "@/models";
import type { Address } from "@/types";
import type { VendorStoreVisibility } from "@/lib/vendors/vendor-address";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { canAccessPOS } from "@/lib/access/rbac";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function StaffPosPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session, staffScope } = await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.ACCESS_POS],
  });

  await connectDB();
  const settings = await getSettings();
  if (!settings.pos?.enabled) {
    redirect(`/${locale}/staff/dashboard`);
  }

  if (!(await canAccessPOS(session.user))) {
    redirect(`/${locale}/staff/dashboard`);
  }

  // Staff assigned to exactly one vendor are that vendor's counter staff, so
  // their receipts print the vendor's store identity. Platform staff and
  // multi-vendor staff keep the platform header — there is no single store
  // to attribute the sale to before it happens.
  let identity: POSReceiptIdentity | undefined;
  if (staffScope.vendorIds.length === 1) {
    const vendor = await Vendor.findById(staffScope.vendorIds[0])
      .select("storeName address storeVisibility")
      .lean<{
        storeName?: string;
        address?: Address;
        storeVisibility?: VendorStoreVisibility;
      } | null>();
    if (vendor) identity = vendorReceiptIdentity(vendor);
  }

  // The shell streams a skeleton while it resolves the product list, so the
  // page never waits on the catalogue query before painting.
  return (
    <POSPageShell
      settings={buildPOSSettings(settings, identity)}
      user={session.user}
    />
  );
}
