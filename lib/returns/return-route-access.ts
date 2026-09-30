import "server-only";

import { Types } from "mongoose";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { isValidObjectId } from "@/lib/api/validate";
import { STAFF_PERMISSIONS, VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getSettings } from "@/models/settings.model";
import { Order, ReturnRequest } from "@/models";
import { vendorReturnsFilter } from "@/lib/returns/return-stats";
import { isReturnVisibleToStaff } from "@/lib/returns/return-staff-scope";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";

/**
 * The one return a caller of the small per-return routes (the label, the
 * "Return to" list) may act on, loaded under the same rules as the main return
 * routes: the store's admins and permitted staff see every return, a seller
 * only their own.
 */

type SessionUser = { id: string; role?: string; roles?: string[] | null };

export type ReturnRouteScope = "admin" | "vendor";

/** A return the caller may act on, or null when there is none to show them. */
export async function loadReturnForRoute(params: {
  scope: ReturnRouteScope;
  user: SessionUser;
  id: string;
  mode: "read" | "write";
}) {
  if (!isValidObjectId(params.id)) return null;

  if (params.scope === "admin") {
    const access = await assertAdminOrStaffPermissions(
      { user: params.user } as unknown as { user: { id: string; role: string } },
      params.mode === "read"
        ? [STAFF_PERMISSIONS.VIEW_ORDERS]
        : [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );
    const returnRequest = await ReturnRequest.findById(params.id).lean();
    // Out of a scoped staff member's reach reads as not there at all — the
    // rule GET/PUT /api/admin/returns/[id] and the returns list apply.
    if (!returnRequest) return null;
    return (await isReturnVisibleToStaff(returnRequest, {
      scope: access.staffScope,
      vendorOwned: access.vendorOwned,
    }))
      ? returnRequest
      : null;
  }

  const user = params.user as Parameters<typeof hasVendorPermission>[0];
  const permissions =
    params.mode === "read"
      ? [VENDOR_PERMISSIONS.VIEW_ORDERS]
      : [VENDOR_PERMISSIONS.EDIT_ORDERS, VENDOR_PERMISSIONS.MANAGE_ORDERS];
  let allowed = isAdmin(user);
  for (const permission of permissions) {
    if (allowed) break;
    allowed = await hasVendorPermission(user, permission);
  }
  if (!allowed) {
    throw new AuthorizationError("You do not have permission to handle returns");
  }
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  const vendor = await requireApprovedVendorByUserId(params.user.id);
  return ReturnRequest.findOne({
    _id: params.id,
    ...vendorReturnsFilter(new Types.ObjectId(String(vendor._id))),
  }).lean();
}

/**
 * The order a return is being opened on, loaded under the caller's rules: a
 * store admin sees every order and staff the ones in their scope, a seller only
 * orders carrying their own consignment. Says too what the caller may do: only
 * the store opens one past the return window, and a seller only for their own
 * lines.
 */
export async function loadOrderForReturnRoute(params: {
  scope: ReturnRouteScope;
  user: SessionUser;
  orderId: string;
  mode: "read" | "write";
}): Promise<{
  order: Record<string, unknown> & { _id: unknown };
  canOverride: boolean;
  onlyVendorId?: string;
} | null> {
  if (!isValidObjectId(params.orderId)) return null;

  if (params.scope === "admin") {
    const access = await assertAdminOrStaffPermissions(
      { user: params.user } as unknown as { user: { id: string; role: string } },
      params.mode === "read"
        ? [STAFF_PERMISSIONS.VIEW_ORDERS]
        : [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );
    const order = await Order.findOne(
      mergeScopeFilter(
        { _id: params.orderId },
        buildStaffOrderScopeFilter(access.staffScope),
      ),
    ).lean<(Record<string, unknown> & { _id: unknown }) | null>();
    if (!order) return null;
    const isFullAdmin = !access.staffPermissions;
    return {
      order,
      canOverride:
        isFullAdmin ||
        Boolean(
          access.staffPermissions?.includes(
            STAFF_PERMISSIONS.CREATE_INELIGIBLE_RETURNS,
          ),
        ),
    };
  }

  const user = params.user as Parameters<typeof hasVendorPermission>[0];
  const permissions =
    params.mode === "read"
      ? [VENDOR_PERMISSIONS.VIEW_ORDERS]
      : [VENDOR_PERMISSIONS.EDIT_ORDERS, VENDOR_PERMISSIONS.MANAGE_ORDERS];
  let allowed = isAdmin(user);
  for (const permission of permissions) {
    if (allowed) break;
    allowed = await hasVendorPermission(user, permission);
  }
  if (!allowed) {
    throw new AuthorizationError("You do not have permission to handle returns");
  }
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  const vendor = await requireApprovedVendorByUserId(params.user.id);
  const vendorId = String(vendor._id);
  const order = await Order.findOne({
    _id: params.orderId,
    "subOrders.vendorId": new Types.ObjectId(vendorId),
  }).lean<(Record<string, unknown> & { _id: unknown }) | null>();
  if (!order) return null;
  return { order, canOverride: false, onlyVendorId: vendorId };
}
