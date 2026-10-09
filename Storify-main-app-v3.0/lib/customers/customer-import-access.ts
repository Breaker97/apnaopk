import { USER_ROLES } from "@/config/app.config";
import {
  STAFF_PERMISSIONS,
  type StaffPermission,
} from "@/config/permissions.config";
import { hasStaffScope, type StaffAccessScope } from "@/lib/access/staff-scope";

/**
 * Who may import customers, decided once for the route that does it and the
 * pages that offer it.
 *
 *  - An admin, or a team member who may create customers.
 *  - Updating the customers a file matches is editing them: it also takes the
 *    edit permission, and access to every customer — a member who sees only
 *    some sellers' customers cannot be pointed at the rest by a file.
 *  - Never a vendor's own staff: they act for one shop, and the customer list
 *    and its email consent belong to the store.
 */
export function customerImportAccess(params: {
  role?: string | null;
  staffPermissions?: readonly StaffPermission[] | null;
  staffScope?: StaffAccessScope | null;
  /** A vendor made this team member; read from the scope when not given. */
  vendorOwned?: boolean;
}): { canImportCustomers: boolean; canUpdateOnImport: boolean } {
  if (params.role === USER_ROLES.ADMIN) {
    return { canImportCustomers: true, canUpdateOnImport: true };
  }
  const vendorOwned = params.vendorOwned ?? Boolean(params.staffScope?.wholeOrdersOnly);
  if (vendorOwned) return { canImportCustomers: false, canUpdateOnImport: false };

  const permissions = params.staffPermissions ?? [];
  const manage = permissions.includes(STAFF_PERMISSIONS.MANAGE_CUSTOMERS);
  const canImportCustomers = manage || permissions.includes(STAFF_PERMISSIONS.CREATE_CUSTOMERS);
  const canEdit = manage || permissions.includes(STAFF_PERMISSIONS.EDIT_CUSTOMERS);
  return {
    canImportCustomers,
    canUpdateOnImport: canImportCustomers && canEdit && !hasStaffScope(params.staffScope),
  };
}
