import { USER_ROLES } from "@/config/app.config";
import { afterResponse } from "@/lib/after-response";

/** The account Better Auth has just written, as its create hook hands it over. */
export type CreatedUser = {
  id?: string;
  _id?: { toString(): string };
  role?: string;
  name?: string;
  email?: string;
  /** Set to "vendor" by the sign-up form a seller applies through. */
  emailVerificationAudience?: string;
};

/**
 * What a new account starts with. A customer gets a profile; and a shopper who
 * made their own account (sign-up, social login, checkout) is announced to the
 * admins as a new customer, as surely as one an admin adds. Only the
 * admin-added kind used to be. Someone signing up to sell is announced as a
 * vendor application instead, once they apply.
 */
export async function onUserCreated(user: CreatedUser): Promise<void> {
  const role = user.role;
  if (role && role !== USER_ROLES.CUSTOMER) return;
  const userId = user.id || user._id?.toString();
  if (!userId) return;

  try {
    const { ensureCustomerProfile } = await import("@/lib/customers/customer");
    await ensureCustomerProfile(userId);
  } catch (error) {
    console.error("Failed to create customer profile:", error);
  }

  if (user.emailVerificationAudience === USER_ROLES.VENDOR) return;
  // After the response: telling the admins never holds up the sign-up.
  afterResponse(async () => {
    const { notifyAdminsNewCustomer } = await import(
      "@/lib/notifications/notifications"
    );
    await notifyAdminsNewCustomer({
      customerId: userId,
      name: user.name,
      email: user.email,
      signedUp: true,
    });
  });
}
