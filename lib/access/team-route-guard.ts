import type { NextRequest } from "next/server";
import { USER_ROLES } from "@/config/app.config";
import { AuthorizationError } from "@/lib/api/errors";
import {
  resolveTeamAccess,
  teamHasAny,
  type TeamAccess,
} from "@/lib/access/team-permissions";
import {
  isAdminApiPath,
  teamApiRequirement,
} from "@/lib/access/team-route-permissions";

/**
 * Holds an administrator to their team role on one API request: the route's
 * own `teamPermissions`, else the rule lib/access/team-route-permissions.ts
 * has for the path. Under /api/admin, and on an admin-only route, a path no
 * rule names is refused to a restricted member. The role is read only when a
 * rule speaks to the path (or the path is the admin API's own), so an
 * administrator browsing the storefront costs nothing.
 *
 * `withApi` calls it for every administrator; the few admin routes that sign
 * the caller in themselves call it after their own admin check.
 */
export async function enforceTeamRole(
  request: Request | NextRequest,
  userId: string,
  options: { adminOnly?: boolean; teamPermissions?: readonly string[] } = {},
): Promise<TeamAccess | undefined> {
  const pathname =
    "nextUrl" in request && request.nextUrl
      ? request.nextUrl.pathname
      : new URL(request.url).pathname;
  const requirement = options.teamPermissions
    ? { kind: "anyOf" as const, permissions: options.teamPermissions }
    : teamApiRequirement(pathname, request.method);
  const adminOnly = isAdminApiPath(pathname) || Boolean(options.adminOnly);
  if (requirement.kind === "none" && !adminOnly) return undefined;

  const access = await resolveTeamAccess(userId);
  if (access.fullAccess) return access;
  if (requirement.kind === "none" || !teamHasAny(access, requirement.permissions)) {
    throw new AuthorizationError("Your team role does not include this.");
  }
  return access;
}

type SessionUser = { id: string; role?: string | null; roles?: string[] | null };

const isAdminUser = (user: SessionUser) =>
  user.role === USER_ROLES.ADMIN || Boolean(user.roles?.includes(USER_ROLES.ADMIN));

/**
 * `enforceTeamRole` for a route that signs the caller in itself and serves
 * staff too: only an administrator (either role field) is held to a team role.
 */
export async function enforceTeamRoleForUser(
  request: Request | NextRequest,
  user: SessionUser,
  options: { adminOnly?: boolean; teamPermissions?: readonly string[] } = {},
): Promise<TeamAccess | undefined> {
  return isAdminUser(user) ? enforceTeamRole(request, user.id, options) : undefined;
}

/**
 * Whether the signed-in user is an administrator whose team role holds one
 * of `anyOf`: for a public route that shows an administrator more (drafts, a
 * commenter's email), where anyone else gets the public answer.
 */
export async function isAdminHolding(
  user: SessionUser | null | undefined,
  anyOf: readonly string[],
): Promise<boolean> {
  if (!user?.id || !isAdminUser(user)) return false;
  return teamHasAny(await resolveTeamAccess(user.id), anyOf);
}

/**
 * Holds an administrator to their role for a check a route makes itself (one
 * that has no request at hand, or that depends on the body): refuses unless
 * the role holds one of `anyOf`.
 */
export async function assertTeamPermission(
  userId: string,
  anyOf: readonly string[],
): Promise<TeamAccess> {
  const access = await resolveTeamAccess(userId);
  if (!teamHasAny(access, anyOf)) {
    throw new AuthorizationError("Your team role does not include this.");
  }
  return access;
}
