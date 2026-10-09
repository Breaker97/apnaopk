import { cache } from "react";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/access/rbac";
import { buildLoginUrl, returnPathFromHeaders } from "@/lib/auth/return-path";
import { localeHref } from "@/lib/i18n/locale-routing";

/**
 * `cache()` because the admin layout and the page it wraps both guard: without
 * it every admin render costs two session lookups for the same cookie. The memo
 * is per-request, so a revoked session still fails on the next navigation.
 */
export const requireAdminPageAccess = cache(async (locale: string) => {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    redirect(
      await localeHref(
        locale,
        buildLoginUrl(
          locale,
          returnPathFromHeaders(requestHeaders) ?? "/admin/dashboard",
        ),
      ),
    );
  }
  // Signed in, but not as an admin. Not the login page: it sends a signed-in
  // visitor straight back to the page they came from, which would be this one
  // again — a redirect loop. The other guards answer this case the same way.
  if (!isAdmin(session.user)) {
    redirect(await localeHref(locale, "/forbidden"));
  }

  return session;
});
