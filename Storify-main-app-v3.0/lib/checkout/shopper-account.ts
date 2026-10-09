import "server-only";
import { ApiError } from "@/lib/api/errors";
import {
  CHECKOUT_EMAIL_NOT_ALLOWED,
  STAFF_ACCOUNT_CHECKOUT,
  isCustomerAccount,
} from "@/lib/access/customer-account";
import { isStaffAccountEmail } from "@/lib/customers/customer";

/**
 * Who may place a storefront order: a shopper, signed in or as a guest.
 *
 * An admin, team member or seller who checked out from the store became their
 * own customer — the order, its stats and its emails were filed under a login
 * that belongs to the dashboard. Orders for other people come from Admin →
 * Create order, the vendor's Create order, or the POS, which take the
 * customer as a separate person. Shopify keeps the two identities apart the
 * same way.
 */

/**
 * Refuses a signed-in account that holds any role besides customer, in
 * `role` or `roles` — both are re-read from the database on every request,
 * so a shopper made a seller is refused without signing out. No session
 * passes: a guest is checked by email instead.
 */
export function assertShopperSession(
  session: { user?: { role?: string | null; roles?: string[] | null } | null } | null | undefined,
): void {
  if (session?.user && !isCustomerAccount(session.user)) {
    throw new ApiError(
      "Orders can't be placed from an admin, team or seller account.",
      403,
      STAFF_ACCOUNT_CHECKOUT,
    );
  }
}

/**
 * Refuses a guest checkout under the email of an admin, team member or
 * seller; otherwise that person becomes a guest customer under their own
 * address. The message never says why, so the checkout cannot be used to
 * learn which addresses are staff logins.
 */
export async function assertGuestEmailAllowed(
  email: string | null | undefined,
): Promise<void> {
  if (email && (await isStaffAccountEmail(email))) {
    throw new ApiError(
      "This email can't be used for checkout. Please use a different email.",
      400,
      CHECKOUT_EMAIL_NOT_ALLOWED,
    );
  }
}
