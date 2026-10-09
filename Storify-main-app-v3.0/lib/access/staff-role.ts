import { USER_ROLES } from "@/config/app.config";

export const STAFF_USER_ROLES = [USER_ROLES.STAFF, USER_ROLES.SELLER] as const;

/**
 * Everyone the admin Team page manages: administrators plus platform staff.
 * Vendor dashboards keep using STAFF_USER_ROLES — a vendor never manages an
 * administrator.
 */
export const TEAM_USER_ROLES = [
  USER_ROLES.ADMIN,
  ...STAFF_USER_ROLES,
] as const;

export function isStaffRole(role?: string | null) {
  return role === USER_ROLES.STAFF || role === USER_ROLES.SELLER;
}

/**
 * Whether an account is on the store's own team — an administrator or
 * platform staff — by either role field (`roles` is absent on rows that
 * predate it). Such an account is never turned into a vendor: a vendor
 * approval leaves its role alone (decideVendorOwnerRoleRepair), so a store
 * it applied for would be one it could never open.
 */
export function holdsTeamRole(user: {
  role?: string | null;
  roles?: unknown;
}): boolean {
  if (user.role === USER_ROLES.ADMIN || isStaffRole(user.role)) return true;
  return (
    Array.isArray(user.roles) &&
    user.roles.some(
      (role) =>
        typeof role === "string" &&
        (role === USER_ROLES.ADMIN || isStaffRole(role)),
    )
  );
}
