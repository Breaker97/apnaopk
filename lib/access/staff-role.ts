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
