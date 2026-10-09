import { USER_ROLES } from "@/config/app.config";

/**
 * The paths a social sign-in arrives on: the redirect flow's callback, and
 * `/sign-in/social`, where the shopper app posts a Google ID token
 * (lib/auth/social-providers.ts). Both go through the guards below, so a
 * social sign-in only ever opens a shopper's session: an admin, vendor or
 * staff account is refused there whichever door is used, and so never
 * reaches a session that skipped its second factor.
 *
 * `/sign-in/social` without a token only answers the redirect URL; no user
 * is created and no session minted on it, so the guards have nothing to do.
 */
const SOCIAL_SIGN_IN_PATHS = new Set(["/callback/:id", "/sign-in/social"]);

export function isOAuthCallbackPath(path?: string | null) {
  return Boolean(path && SOCIAL_SIGN_IN_PATHS.has(path));
}

export function forceCustomerRoleForOAuthUser<
  T extends Record<string, unknown>,
>(user: T, path?: string | null) {
  if (!isOAuthCallbackPath(path)) return user;
  return {
    ...user,
    role: USER_ROLES.CUSTOMER,
    roles: [USER_ROLES.CUSTOMER],
  };
}

export function assertOAuthCustomerOnlySession(path?: string | null, role?: string) {
  return !isOAuthCallbackPath(path) || !role || role === USER_ROLES.CUSTOMER;
}
