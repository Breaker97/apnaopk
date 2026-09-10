import "server-only";

import { redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getVendorStatement, resolveRequestedPeriod } from "@/lib/finance/reports";

/**
 * The guard and the load every vendor finance screen repeats.
 *
 * Four pages need the same four things — the permission, the multi-vendor gate,
 * the vendor, and their statement for the chosen period — and four copies of
 * that would drift on the first change to any of them. In particular the gate:
 * without multi-vendor mode there is no marketplace holding money on anyone's
 * behalf, and a screen describing that relationship would be fiction.
 */
export async function guardVendorFinance(locale: string) {
  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_PAYOUTS],
  });

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) {
    redirect(`/${locale}/vendor/dashboard`);
  }

  const vendor = await requireApprovedVendorByUserId(access.session.user.id);
  return {
    vendor,
    storeCurrency: settings.general?.defaultCurrency || "USD",
  };
}

/**
 * The guard plus the statement, for the screens that show one.
 *
 * Split from the guard because the expenses screen needs the first half and
 * nothing else — running a whole ledger aggregation to read one currency code
 * is a page that gets slower for no reason anyone can see.
 */
function readParam(
  search: { [key: string]: string | string[] | undefined } | undefined,
  key: string,
): string | undefined {
  const value = search?.[key];
  return typeof value === "string" ? value : undefined;
}

export async function loadVendorFinance(params: {
  locale: string;
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const guarded = await guardVendorFinance(params.locale);
  // The same resolution the admin screens use, so a link built on one side of
  // the marketplace means the same span on the other.
  const period = resolveRequestedPeriod({
    period: readParam(params.searchParams, "period"),
    from: readParam(params.searchParams, "from"),
    to: readParam(params.searchParams, "to"),
  });
  const statements = await getVendorStatement(String(guarded.vendor._id), period);

  return { ...guarded, period, statements };
}
