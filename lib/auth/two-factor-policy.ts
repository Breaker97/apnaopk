import { getSettingsLean } from "@/models";
import { isAdmin, isVendor, isSeller } from "@/lib/access/rbac";
import type { UserRole } from "@/config/app.config";

/**
 * Two-Factor Authentication policy, sourced from the admin security settings
 * (`settings.security`), configured in the admin Two-Factor Authentication
 * panel.
 *
 * 2FA is a personal preference, never a mandate: the admin toggles only decide
 * which roles are *offered* self-service enrollment in their account settings.
 * Users who enroll get the 2FA challenge at login; everyone else signs in with
 * their password alone. Nothing redirects a non-enrolled user to a setup page.
 */
interface TwoFactorPolicy {
  /** Master switch. When false, 2FA is unavailable to everyone. */
  enabled: boolean;
  /** Offer self-service 2FA to administrators. */
  requiredForAdmin: boolean;
  /** Offer self-service 2FA to approved vendors. */
  requiredForVendors: boolean;
  /** Offer self-service 2FA to staff/seller accounts. */
  requiredForStaff: boolean;
}

/**
 * Read the store-wide 2FA policy from settings.
 */
export async function getTwoFactorPolicy(): Promise<TwoFactorPolicy> {
  const settings = await getSettingsLean();
  const security = settings.security;
  return {
    enabled: Boolean(security?.twoFactorEnabled),
    requiredForAdmin: Boolean(security?.twoFactorRequiredForAdmin),
    requiredForVendors: Boolean(security?.twoFactorRequiredForVendors),
    requiredForStaff: Boolean(security?.twoFactorRequiredForStaff),
  };
}

/**
 * Whether self-service 2FA should be offered to this user in their account
 * settings. Privileged roles (admin / vendor / staff) are gated by their
 * per-role toggle; everyone else (e.g. customers) is governed by the master
 * switch alone. Used by the profile/security pages to show or hide the
 * `TwoFactorManagementCard`.
 */
export function isTwoFactorAvailableForUser(
  user: { role?: UserRole; roles?: UserRole[] },
  policy: TwoFactorPolicy,
): boolean {
  if (!policy.enabled) return false;
  if (isAdmin(user)) return policy.requiredForAdmin;
  if (isVendor(user)) return policy.requiredForVendors;
  if (isSeller(user)) return policy.requiredForStaff;
  return true;
}
