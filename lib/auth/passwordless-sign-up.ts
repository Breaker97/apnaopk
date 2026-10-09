import "server-only";

import { ObjectId } from "mongodb";
import { connectDB, mongoose } from "@/lib/db";
import { User } from "@/models";
import { USER_ACCOUNT_STATUS } from "@/config/app.config";
import { isValidLocale } from "@/config/i18n.config";
import { isCustomerAccount } from "@/lib/access/customer-account";
import { getCredentialAccount } from "@/lib/auth/auth-credentials";
import {
  recentAccountAccessEmails,
  sendAccountAccessEmail,
} from "@/lib/auth/account-access";
import { afterResponse } from "@/lib/after-response";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale-prefix";

/**
 * A shopper whose account the store made — an imported customer, one an
 * admin added — has an account and no password. "Create account" with their
 * email used to answer "a user with this email already exists", and nothing on
 * the page told them how to get in.
 *
 * Now the sign-up is answered the way a sign-up that waits on a verification
 * email is (no session yet, "check your email"), and the email that arrives is
 * the account invite: the link that sets their password. The password typed on
 * the form is not used — anyone can type an email there, and taking it would
 * hand the account to them; opening the link is what proves the address. The
 * same goes for the "Resend" on the page that follows.
 *
 * Accounts with a password, a team member's or a seller's login, and banned or
 * inactive accounts are left to Better Auth's own answer, as before.
 */

/** The shopper's account by email, when it is a store-made one with no password. */
export async function findPasswordlessCustomer(
  email: unknown,
): Promise<{ id: string; email: string } | null> {
  const address = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!address) return null;
  await connectDB();
  const user = await User.findOne({ email: address })
    .select("role roles status")
    .lean<{ _id: mongoose.Types.ObjectId; role?: string; roles?: string[]; status?: string } | null>();
  if (!user || !isCustomerAccount(user)) return null;
  if (user.status && user.status !== USER_ACCOUNT_STATUS.ACTIVE) return null;

  const db = mongoose.connection.db;
  if (!db) return null;
  const credential = await getCredentialAccount(db, new ObjectId(String(user._id)));
  if (credential?.password) return null;
  return { id: String(user._id), email: address };
}

/**
 * The language the visitor was using: the first segment of the page the form
 * would return them to, else the locale cookie. The email's link opens in it,
 * when the store serves it.
 */
export function localeOfAuthRequest(
  callbackURL: unknown,
  headers: Headers | undefined,
): string | null {
  if (typeof callbackURL === "string") {
    try {
      const segment = new URL(callbackURL, "http://local.invalid").pathname.split("/")[1] ?? "";
      if (isValidLocale(segment)) return segment;
    } catch {
      // Not a URL; fall through to the cookie.
    }
  }
  const cookie = headers?.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE_NAME}=([^;]+)`));
  const fromCookie = match ? decodeURIComponent(match[1]) : "";
  return isValidLocale(fromCookie) ? fromCookie : null;
}

/**
 * Send the account invite in place of a sign-up or a verification link, when
 * the email is a password-less customer's. Returns whether it answered for
 * them; false means the request goes on to Better Auth unchanged.
 *
 * One email per address per 15 minutes, as every account email: a second
 * attempt is answered the same way and sends nothing new.
 */
export async function inviteInsteadOfSignUp(params: {
  email: unknown;
  locale: string | null;
}): Promise<boolean> {
  const customer = await findPasswordlessCustomer(params.email);
  if (!customer) return false;

  const recent = await recentAccountAccessEmails([customer.email]);
  if (!recent.has(customer.email)) {
    // After the response, so the answer takes as long whatever happens next.
    afterResponse(async () => {
      await sendAccountAccessEmail({
        userId: customer.id,
        delivery: "outbox",
        locale: params.locale,
      });
    });
  }
  return true;
}
