import { USER_ROLES } from "@/config/app.config";

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
