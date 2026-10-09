import "server-only";

import { NotFoundError } from "@/lib/api/errors";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import type { AbandonedCheckoutViewer } from "@/lib/orders/abandoned-checkout-list";

/**
 * Who a vendor's Abandoned checkouts page and API are reading for.
 *
 * The vendor always comes from the signed-in account, never from the request,
 * so no id in a URL can point either at another seller's checkouts.
 */

type VendorAbandonedSettings =
  | {
      multiVendorMode?: { enabled?: boolean | null } | null;
      vendorConfig?: { showAbandonedCheckoutsToVendors?: boolean | null } | null;
    }
  | null
  | undefined;

/**
 * The store's switch (Vendors → Configuration → Abandoned checkouts), on a
 * marketplace. On unless the store turned it off — read straight off the
 * document, where an older store has no value at all.
 */
export function vendorsSeeAbandonedCheckouts(settings: VendorAbandonedSettings): boolean {
  return (
    Boolean(settings?.multiVendorMode?.enabled) &&
    settings?.vendorConfig?.showAbandonedCheckoutsToVendors !== false
  );
}

/**
 * The signed-in vendor as a reader of its abandoned checkouts. Refuses a store
 * that is not a marketplace or has switched the page off for vendors, and a
 * vendor that is not approved.
 */
export async function requireVendorAbandonedCheckoutViewer(
  userId: string,
): Promise<Extract<AbandonedCheckoutViewer, { kind: "vendor" }>> {
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  if (!vendorsSeeAbandonedCheckouts(settings)) {
    throw new NotFoundError("Abandoned checkouts");
  }
  const vendor = await requireApprovedVendorByUserId(userId);
  return { kind: "vendor", vendorId: String(vendor._id) };
}
