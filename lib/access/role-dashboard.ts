import { appConfig, USER_ROLES } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { splitLocalePath } from "@/lib/i18n/locale-prefix";

/** The back office, as the first segment of a locale-less path. */
const DASHBOARD_AREAS = new Set(["admin", "vendor", "staff"]);

/**
 * Whether a path — prefixed with its language or not — is one of the
 * dashboards rather than the storefront (whose vendor directory is
 * `/vendors/…`, plural).
 */
export function isDashboardPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const area = splitLocalePath(pathname).rest.split("/")[1] ?? "";
  return DASHBOARD_AREAS.has(area);
}

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
