import { cache } from "react";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/access/rbac";
import { buildLoginUrl, returnPathFromHeaders } from "@/lib/auth/return-path";
import { localeHref } from "@/lib/i18n/locale-routing";
import {
  resolveTeamAccess,
  teamHasAny,
  type TeamAccess,
} from "@/lib/access/team-permissions";
import { teamPageRequirement } from "@/lib/access/team-route-permissions";

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

/**
 * The signed-in administrator's team access (role and permissions), once per
 * request however many layouts ask.
 */
export const getAdminTeamAccess = cache(async (userId: string): Promise<TeamAccess> =>
  resolveTeamAccess(userId),
);

/**
 * Where the dashboard opens for a member: the first area in sidebar order
 * their role reaches, else their own profile (always open).
 */
export function firstAdminAreaFor(access: TeamAccess): string {
  for (const path of ADMIN_LANDING_ORDER) {
    const required = teamPageRequirement(path);
    if (required && teamHasAny(access, required)) return path;
  }
  return "/admin/profile";
}

const ADMIN_LANDING_ORDER = [
  "/admin/dashboard",
  "/admin/orders",
  "/admin/products",
  "/admin/customers",
  "/admin/inbox",
  "/admin/inventory",
  "/admin/vendors",
  "/admin/online-store",
  "/admin/analytics",
  "/admin/finance",
  "/admin/settings/general",
];

/**
 * An admin dashboard area's guard (its layout calls it): an administrator
 * whose role reaches `areaPath` (lib/access/team-route-permissions.ts) gets
 * the session back; anyone else is sent to the first area they do reach.
 */
export async function requireAdminArea(locale: string, areaPath: string) {
  const session = await requireAdminPageAccess(locale);
  const required = teamPageRequirement(areaPath);
  if (!required || required.length === 0) return session;
  const access = await getAdminTeamAccess(session.user.id);
  if (teamHasAny(access, required)) return session;
  redirect(await localeHref(locale, firstAdminAreaFor(access)));
}
