import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { USER_ROLES } from "@/config/app.config";
import { getRoleDashboardPath } from "@/lib/access/role-dashboard";
import { auth } from "@/lib/auth/auth";
import { sanitizeReturnPath } from "@/lib/auth/return-path";
import { localeHref } from "@/lib/i18n/locale-routing";
import { isMultiVendorEnabled } from "@/lib/vendors/multi-vendor";

type SearchParams = Record<string, string | string[] | undefined>;

/** The props Next hands a page under app/[locale]/(auth). */
export interface GuestPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}

/**
 * Where a signed-in account goes from the sign-in flow: back to the page it
 * asked to return to, when that is a path on this store, or else its own
 * landing page — the admin, seller or team dashboard, or the customer account.
 *
 * role-redirect (after Google, Facebook and sign-up) and the guest pages that
 * turn a signed-in visitor away both ask here, so the same person is never
 * sent to two different places.
 */
export async function getPostLoginDestination({
  locale,
  role,
  returnTo,
}: {
  locale: string;
  role: string | null | undefined;
  /** The raw `redirect` / `callbackUrl` value — checked here, never trusted. */
  returnTo?: string | null;
}): Promise<string> {
  const returnPath = sanitizeReturnPath(returnTo);
  if (returnPath) return localeHref(locale, returnPath);

  // A seller's dashboard exists only while the store runs in multi-vendor
  // mode; without it the account page is theirs, as it is a shopper's.
  const sellerWithoutMarketplace =
    role === USER_ROLES.VENDOR && !(await isMultiVendorEnabled());
  const dashboard = sellerWithoutMarketplace
    ? null
    : getRoleDashboardPath(locale, role);
  return localeHref(locale, dashboard ?? `/${locale}/account`);
}

/** A query param's first value, as `URLSearchParams.get` reads it. */
function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Sign-in, sign-up and forgot password are for guests. A signed-in visitor who
 * opens one — Back after signing in, a bookmark, an old link — is sent on
 * before any HTML: a check in the browser would flash the form first and
 * hydrate against a session the server never drew.
 *
 * Reset password, verify email, email verified and role-redirect stay open: a
 * reset link can belong to another account, and the rest finish a flow.
 *
 * A two-factor sign-in has no session until its code is checked (the
 * two-factor plugin deletes the one the password step made), so the code
 * screen on /login is never cut short — tests/post-login-destination.test.ts
 * holds that against the real plugin.
 */
export async function redirectSignedInVisitor({
  params,
  searchParams,
}: GuestPageProps): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return;

  const [{ locale }, query] = await Promise.all([params, searchParams]);
  redirect(
    await getPostLoginDestination({
      locale,
      role: session.user.role,
      // Read as the sign-in form reads it: `redirect` first, then the
      // app-wide `callbackUrl`.
      returnTo: firstValue(query.redirect) || firstValue(query.callbackUrl),
    }),
  );
}
