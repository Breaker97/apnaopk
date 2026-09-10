import { appConfig, USER_ROLES } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";

/**
 * The customer account area (`/[locale]/account`) is customer-only: every
 * staff-side role has its own dashboard and never browses the store as a
 * customer (Shopify-style separation — use a separate customer account for
 * test orders). Returns that dashboard path for admin/vendor/staff roles,
 * and null for customers and guests, who belong in `/account`.
 *
 * Safe on both server and client.
 */
export function getRoleDashboardPath(
  locale: string,
  role?: string | null,
): string | null {
  if (role === USER_ROLES.ADMIN) {
    return `/${locale}${appConfig.urls.adminDashboard}`;
  }
  if (role === USER_ROLES.VENDOR) {
    return `/${locale}${appConfig.urls.vendorDashboard}`;
  }
  if (isStaffRole(role)) {
    return `/${locale}${appConfig.urls.staffDashboard}`;
  }
  return null;
}
