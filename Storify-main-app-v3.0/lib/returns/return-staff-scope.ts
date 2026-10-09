import { Order } from "@/models";
import {
  buildStaffOrderScopeFilter,
  hasStaffScope,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";

/**
 * Which returns a staff member may see and act on.
 *
 * A return is visible when its order is — the rule the returns list and the
 * order page keep. A vendor's own staff also see only their vendor's returns,
 * what the vendor's returns page shows; and since their order scope is orders
 * wholly their vendor's (`StaffAccessScope.wholeOrdersOnly`), a return on a
 * split order is the vendor's to handle, like the order itself.
 */

type StaffReturnAccess = {
  scope?: StaffAccessScope | null;
  vendorOwned?: boolean;
};

type ReturnOwnership = {
  orderId?: unknown;
  ownerType?: string | null;
  ownerVendorId?: unknown;
  vendorIds?: unknown[] | null;
};

/** The vendor returns page's filter, for a vendor's own staff. */
export function buildVendorStaffReturnFilter(
  scope: StaffAccessScope,
): Record<string, unknown> {
  return {
    $or: [
      { ownerType: "vendor", ownerVendorId: { $in: scope.vendorIds } },
      // Written before returns were split by owner.
      { ownerType: { $exists: false }, vendorIds: { $in: scope.vendorIds } },
    ],
  };
}

function isVendorStaffReturn(
  returnRequest: ReturnOwnership,
  scope: StaffAccessScope,
): boolean {
  const vendors = new Set(scope.vendorIds.map(String));
  if (returnRequest.ownerType === "vendor") {
    const owner = idOf(returnRequest.ownerVendorId);
    return owner !== null && vendors.has(owner);
  }
  if (returnRequest.ownerType == null) {
    return (returnRequest.vendorIds ?? []).some((id) => {
      const vendor = idOf(id);
      return vendor !== null && vendors.has(vendor);
    });
  }
  return false;
}

/** An id, whether the reference is bare or populated (`{ _id, storeName }`). */
function idOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object" && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

export async function isReturnVisibleToStaff(
  returnRequest: ReturnOwnership,
  access: StaffReturnAccess,
): Promise<boolean> {
  if (!hasStaffScope(access.scope)) return true;
  if (access.vendorOwned && !isVendorStaffReturn(returnRequest, access.scope!)) {
    return false;
  }
  const order = await Order.exists(
    mergeScopeFilter(
      { _id: returnRequest.orderId },
      buildStaffOrderScopeFilter(access.scope),
    ),
  );
  return Boolean(order);
}
