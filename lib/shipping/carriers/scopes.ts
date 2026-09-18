import "server-only";

import { STAFF_PERMISSIONS, VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { buildStaffOrderScopeFilter } from "@/lib/access/staff-scope";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { AuthorizationError } from "@/lib/api/errors";
import { loadShipmentScope } from "./order-scope";
import type { ScopeResolver } from "./route-handlers";

/**
 * The two ways into a carrier route.
 *
 * Both go through `loadShipmentScope`, so the difference is only which orders
 * are visible and which sub-order the caller acts on — everything downstream
 * is identical.
 */

/**
 * Admin/staff. Deliberately `auth: "user"` + a staff-permission assertion
 * rather than `auth: "admin"`, matching the existing shipments route: staff
 * with EDIT_ORDERS can ship, and their location scope still applies.
 */
export const adminShipmentScope: ScopeResolver = async ({
  session,
  orderId,
  subOrderId,
  intent,
  requireSubOrder,
}) => {
  const access = await assertAdminOrStaffPermissions(
    session,
    intent === "write"
      ? [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS]
      : [STAFF_PERMISSIONS.VIEW_ORDERS],
  );

  return loadShipmentScope({
    orderId,
    subOrderId,
    requireSubOrder,
    orderFilter: buildStaffOrderScopeFilter(access.staffScope),
  });
};

/**
 * Vendor. Pinned to their own sub-order, and — unlike `PUT
 * /api/vendor/orders/[id]` — NOT gated on `multiVendorMode.enabled`: a
 * single-vendor store still has exactly one vendor, and gating here would stop
 * the default vendor shipping its own orders.
 */
export const vendorShipmentScope: ScopeResolver = async ({
  session,
  orderId,
  intent,
  requireSubOrder,
}) => {
  const user = session.user;
  const permission =
    intent === "write"
      ? VENDOR_PERMISSIONS.EDIT_ORDERS
      : VENDOR_PERMISSIONS.VIEW_ORDERS;
  const allowed = await hasVendorPermission(user, permission);
  if (!allowed && !isAdmin(user)) throw new AuthorizationError();

  const vendor = await requireApprovedVendorByUserId(session.user.id);
  const vendorId = String(vendor._id);

  return loadShipmentScope({
    orderId,
    vendorId,
    requireSubOrder,
    orderFilter: { "subOrders.vendorId": vendor._id },
  });
};
