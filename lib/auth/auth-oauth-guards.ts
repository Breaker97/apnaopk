import { USER_ROLES } from "@/config/app.config";

/**
 * The only path an OAuth sign-in can arrive on. ID-token sign-in
 * (`/sign-in/social` with an `idToken`) is switched off in
 * `lib/auth/social-providers.ts`; turning it on without adding that path here
 * would let a privileged account past both guards below, and past 2FA.
 */
export function isOAuthCallbackPath(path?: string | null) {
  return path === "/callback/:id";
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
