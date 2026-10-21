import "server-only";

import { Order } from "@/models";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { isValidObjectId } from "@/lib/api/validate";
import { canAccessPOS } from "@/lib/access/rbac";
import { isStaffRole } from "@/lib/access/staff-role";
import { buildStaffOrderScopeFilter, mergeScopeFilter } from "@/lib/access/staff-scope";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { USER_ROLES } from "@/config/app.config";
import { canAccessPOSInvoiceOrder } from "@/lib/pos/payment";
import type { OrderInvoiceSource } from "@/lib/orders/order-invoice";

/**
 * A counter sale the signed-in register may open: print its invoice, send its
 * receipt, take a return against it.
 *
 * One rule for all three, because they all answer "is this one of my till's
 * sales": an admin's register reaches every POS order, a staff member's only
 * those inside their scope, a vendor's only those carrying their goods. It was
 * written once inside the invoice route; a second copy for receipts would be
 * the copy that drifts.
 *
 * Throws 404 for an order that is not there or not reachable — a register
 * learns nothing about another merchant's sales by asking.
 */
/**
 * The query that limits a register to its own counter sales, and the vendor
 * it sells for (null for an admin's or a staff member's register).
 */
export async function posOrderScope(
  user: { id: string; role?: string | null },
): Promise<{ query: Record<string, unknown>; vendorId: unknown }> {
  const role = user.role;
  if (role !== USER_ROLES.ADMIN && role !== USER_ROLES.VENDOR && !isStaffRole(role)) {
    throw new AuthorizationError();
  }
  if (!(await canAccessPOS({ id: user.id, role: role ?? undefined }))) {
    throw new AuthorizationError();
  }

  let query: Record<string, unknown> = { channel: "pos" };
  let vendorId: unknown = null;
  if (isStaffRole(role)) {
    const access = await assertAdminOrStaffPermissions(
      { user: { id: user.id, role: String(role) } },
      [STAFF_PERMISSIONS.ACCESS_POS],
    );
    query = mergeScopeFilter(query, buildStaffOrderScopeFilter(access.staffScope));
  } else if (role === USER_ROLES.VENDOR) {
    const vendor = await requireApprovedVendorByUserId(user.id);
    vendorId = vendor._id;
    query = {
      $and: [
        query,
        { $or: [{ "items.vendorId": vendor._id }, { "subOrders.vendorId": vendor._id }] },
      ],
    };
  }
  return { query, vendorId };
}

export async function loadAccessiblePOSOrder(
  user: { id: string; role?: string | null },
  orderId: string,
): Promise<OrderInvoiceSource> {
  const { query, vendorId } = await posOrderScope(user);
  if (!isValidObjectId(orderId)) throw new NotFoundError("Order");

  const order = await Order.findOne({ $and: [query, { _id: orderId }] })
    .populate("customerId", "name email phone")
    .lean<OrderInvoiceSource>();
  if (!order) throw new NotFoundError("Order");

  if (!canAccessPOSInvoiceOrder({ user, order, vendorId })) {
    throw new AuthorizationError();
  }
  return order;
}
