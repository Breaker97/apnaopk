import { USER_ROLES } from "@/config/app.config";

/**
 * A shopper's account and nothing more: no admin, vendor or staff role in the
 * legacy `role` field or the `roles` array. The customer screens change only
 * these, and a guest checkout is filed only under one. A seller, a team
 * member or an admin can carry a customer profile from before they had that
 * role, and their login belongs to the screen that owns the role — where the
 * owner and last-admin rules are kept.
 *
 * Free of model imports, so the customer service can use it.
 */
export function isCustomerAccount(
  user: { role?: string | null; roles?: string[] | null } | null | undefined,
): boolean {
  if (!user) return false;
  const roles = [user.role, ...(user.roles ?? [])].filter(Boolean);
  return roles.length > 0 && roles.every((role) => role === USER_ROLES.CUSTOMER);
}

const NON_CUSTOMER_ROLES = Object.values(USER_ROLES).filter(
  (role) => role !== USER_ROLES.CUSTOMER,
);

/**
 * The accounts `isCustomerAccount` turns away for holding another role, as a
 * user query — for the lists that must leave them out without loading each
 * account. Both fields are read, as every role check here does, and both are
 * indexed.
 */
export const NON_CUSTOMER_ACCOUNT_FILTER = {
  $or: [
    { role: { $in: NON_CUSTOMER_ROLES } },
    { roles: { $in: NON_CUSTOMER_ROLES } },
  ],
};
