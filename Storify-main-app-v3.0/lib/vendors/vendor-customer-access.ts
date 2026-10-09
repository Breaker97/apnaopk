import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { AuthorizationError } from "@/lib/api/errors";
import { hasVendorPermission, isAdmin, type MinimalUser } from "@/lib/access/rbac";

/**
 * Who may reach a seller's customers over the API. Shared by the list, its Tag
 * filter's options and its CSV export, so no one of them can open a door the
 * others keep shut.
 */

export async function requireVendorOrderPermission(user: MinimalUser) {
  if (isAdmin(user)) return;
  const canCreate = await hasVendorPermission(
    user,
    VENDOR_PERMISSIONS.CREATE_ORDERS,
  );
  if (canCreate) return;
  const canManage = await hasVendorPermission(
    user,
    VENDOR_PERMISSIONS.MANAGE_ORDERS,
  );
  if (canManage) return;
  throw new AuthorizationError(
    "You do not have permission to create orders",
  );
}

/**
 * Reading the list additionally opens to view_orders: the customers page
 * derives entirely from orders the vendor can already see, so it exposes
 * nothing an order-viewing member doesn't have. Creating customers (POST)
 * stays behind the order-creation permissions.
 */
export async function requireVendorCustomerListPermission(user: MinimalUser) {
  if (isAdmin(user)) return;
  if (await hasVendorPermission(user, VENDOR_PERMISSIONS.VIEW_ORDERS)) return;
  return requireVendorOrderPermission(user);
}
