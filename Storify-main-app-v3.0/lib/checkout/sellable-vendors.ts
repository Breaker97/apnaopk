import { ValidationError } from "@/lib/api/errors";
import { VENDOR_STATUS } from "@/config/app.config";
import { Vendor } from "@/models";

/**
 * Refuse a cart holding products from a vendor that may not sell right now.
 *
 * Every vendor in the cart must be approved AND have an active store. A
 * deactivated store (lapsed paid plan) or a suspended vendor takes no new
 * orders, so its products fail this count and the order is refused. Shared by
 * every route that turns a cart into an order in multi-vendor mode.
 */
export async function assertCartVendorsSellable(
  vendorIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = Array.from(new Set(vendorIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return;
  const sellableVendorCount = await Vendor.countDocuments({
    _id: { $in: ids },
    status: VENDOR_STATUS.APPROVED,
    storeActive: { $ne: false },
  });
  if (sellableVendorCount !== ids.length) {
    throw new ValidationError({
      cart: ["One or more products are no longer available"],
    });
  }
}
