import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { isAdmin } from "@/lib/access/rbac";
import type { StaffPermission } from "@/config/permissions.config";
import {
  assertAdminOrStaffPermissions,
} from "@/lib/access/staff-authz";
import type { StaffAccessScope } from "@/lib/access/staff-scope";
import type { TeamAccess } from "@/lib/access/team-permissions";
import { enforceTeamRole } from "@/lib/access/team-route-guard";
import { auditAccessDenied } from "@/lib/access/access-denied-audit";
import { isStaffRole } from "@/lib/access/staff-role";
import { afterResponse } from "@/lib/after-response";
import { createAuditContext } from "@/lib/audit";
import {
  rateLimitByIP,
  rateLimitByUser,
  type RateLimitPreset,
} from "@/lib/api/rate-limit-middleware";
import {
  handleApiError,
  AuthenticationError,
  AuthorizationError,
} from "@/lib/api/errors";
import { getDemoModeMutationResponse } from "@/lib/demo-mode";

/**
 * Route-handler wrapper that owns the boilerplate every API route repeats:
 * DB connection, session loading, role gating, rate limiting, awaiting
 * dynamic route params, and the try/catch that funnels errors through
 * `handleApiError`.
 *
 * ```ts
 * export const GET = withApi({ auth: "optional" }, async ({ request, session }) => {
 *   ...
 *   return successResponse(data);
 * });
 *
 * export const PUT = withApi<{ id: string }>(
 *   {
 *     auth: "admin",
 *     rateLimit: { action: "admin:coupons:update", preset: "moderate" },
 *   },
 *   async ({ request, params, session }) => {
 *     // session is non-null here; params.id is typed
 *     return successResponse(await update(params.id));
 *   },
 * );
 * ```
 *
 * Auth modes:
 * - undefined        — public route; the session is not loaded.
 * - "optional"       — session is loaded but may be null (public routes
 *                      that render more for admins).
 * - "user"           — any authenticated session required.
 * - "admin"          — authenticated admin required.
 * - "admin-or-staff" — admin, or an active staff member holding
 *                      `staffPermissions` (checked in `staffMode`);
 *                      the staff grants land in `ctx.staff`.
 *
 * An administrator is further held to their team role (Owner and
 * Administrator: everything): the route's `teamPermissions`, else the rule
 * for its path in lib/access/team-route-permissions.ts. Under /api/admin, and
 * on any `auth: "admin"` route, a path no rule names is refused to a
 * restricted member. Their access lands in `ctx.team`.
 *
 * Demo modes (`demo`, only meaningful while DEMO_MODE is on):
 * - undefined         — refuse DELETE, allow creates and updates (default).
 * - "block-mutations" — refuse every write.
 * - "allow"           — never refuse.
 *
 * `demoMessage` replaces the refusal wording where the generic notice would
 * describe the surface wrongly.
 */

export type ApiSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

interface StaffGrants {
  /** Set for staff callers; undefined when the caller is a full admin. */
  permissions?: StaffPermission[];
  scope?: StaffAccessScope;
  /** A vendor created this staff member — they act for that vendor only. */
  vendorOwned?: boolean;
}

interface ApiContext<TParams> {
  request: NextRequest;
  /** Awaited dynamic route params (empty object for static routes). */
  params: TParams;
  session: ApiSession | null;
  /** Present only for auth: "admin-or-staff". */
  staff?: StaffGrants;
  /** The administrator's team role and permissions, when the route needed them. */
  team?: TeamAccess;
}

interface AuthedApiContext<TParams> extends ApiContext<TParams> {
  session: ApiSession;
}

interface WithApiOptions {
  auth?: "optional" | "user" | "admin" | "admin-or-staff";
  /** Permissions required for staff callers (auth: "admin-or-staff"). */
  staffPermissions?: StaffPermission[];
  /** Whether staff need any (default) or all of `staffPermissions`. */
  staffMode?: "any" | "all";
  /**
   * What an administrator's team role must hold (any one), instead of the
   * rule lib/access/team-route-permissions.ts has for the path.
   */
  teamPermissions?: readonly string[];
  /**
   * Per-user rate limit (per-IP when the route is public / the caller is
   * anonymous). `action` names the bucket, e.g. "admin:coupons:list".
   */
  rateLimit?: { action: string; preset?: RateLimitPreset };
  /** Set false for routes that never touch Mongoose. Defaults to true. */
  db?: boolean;
  /**
   * How this route behaves on a demo deployment. A demo site has to stay
   * explorable — visitors create products, edit orders, upload images — so
   * only destructive calls are refused by default. Two escapes:
   * - "block-mutations": refuse every write. For settings and profile edits
   *   (a demo visitor must not repoint storage or rename the store) and for
   *   actions that reach a real external service, e.g. sending email.
   * - "allow": never refuse, including DELETE. For data a shopper owns and
   *   must be able to remove — cart lines, wishlist, addresses.
   */
  demo?: "block-mutations" | "allow";
  /**
   * Wording for the refusal, when the generic notice would misdescribe the
   * surface — e.g. the page builder, where a visitor may edit everything on
   * screen and only the persistence is off.
   */
  demoMessage?: string;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isDemoRefused(policy: WithApiOptions["demo"], method: string) {
  if (policy === "allow") return false;
  if (policy === "block-mutations") return WRITE_METHODS.has(method);
  return method === "DELETE";
}

type RouteHandler<TParams> = (
  request: NextRequest,
  context: { params: Promise<TParams> },
) => Promise<NextResponse | Response>;

export function withApi<TParams = Record<string, never>>(
  options: WithApiOptions & { auth: "user" | "admin" | "admin-or-staff" },
  handler: (ctx: AuthedApiContext<TParams>) => Promise<NextResponse | Response>,
): RouteHandler<TParams>;
export function withApi<TParams = Record<string, never>>(
  options: WithApiOptions & { auth?: "optional" },
  handler: (ctx: ApiContext<TParams>) => Promise<NextResponse | Response>,
): RouteHandler<TParams>;
export function withApi<TParams = Record<string, never>>(
  options: WithApiOptions,
  handler: (ctx: AuthedApiContext<TParams>) => Promise<NextResponse | Response>,
): RouteHandler<TParams> {
  return async (request, context) => {
    let session: ApiSession | null = null;
    try {
      let staff: StaffGrants | undefined;
      let team: TeamAccess | undefined;

      if (options.auth) {
        session = await auth.api.getSession({ headers: await headers() });
        if (options.auth !== "optional") {
          if (!session) throw new AuthenticationError();
          if (options.auth === "admin" && !isAdmin(session.user)) {
            throw new AuthorizationError();
          }
          if (options.auth === "admin-or-staff") {
            const grants = await assertAdminOrStaffPermissions(
              session as unknown as { user: { id: string; role: string } },
              options.staffPermissions,
              options.staffMode,
            );
            staff = {
              permissions: grants.staffPermissions,
              scope: grants.staffScope,
              vendorOwned: grants.vendorOwned,
            };
          }
        }
      }

      if (session && isAdmin(session.user)) {
        team = await enforceTeamRole(request, session.user.id, {
          adminOnly: options.auth === "admin",
          teamPermissions: options.teamPermissions,
        });
      }

      // After auth so anonymous callers still get a 401 rather than a demo
      // notice, and before rate limiting so a refused call costs no quota.
      const demoBlock = getDemoModeMutationResponse({
        when: isDemoRefused(options.demo, request.method),
        ...(options.demoMessage ? { message: options.demoMessage } : {}),
      });
      if (demoBlock) return demoBlock;

      if (options.rateLimit) {
        const preset = options.rateLimit.preset ?? "lenient";
        if (session) {
          await rateLimitByUser(
            request,
            session.user.id,
            options.rateLimit.action,
            preset,
            session.user.role,
          );
        } else {
          await rateLimitByIP(request, preset);
        }
      }

      if (options.db !== false) await connectDB();

      const params = context?.params
        ? await context.params
        : ({} as TParams);

      // The overloads guarantee handlers only see a non-null session when
      // they declared auth: "user" | "admin" | "admin-or-staff"; the cast
      // reflects that.
      return await handler({
        request,
        params,
        session: session as ApiSession,
        staff,
        team,
      });
    } catch (error) {
      if (error instanceof AuthorizationError && session) recordRefusal(request, session, error);
      return handleApiError(error);
    }
  };
}

/**
 * A refusal answered to a member of the team goes into the Activity Log
 * (lib/access/access-denied-audit.ts), after the answer. A shopper or a seller
 * refused a team route is not the team's to record.
 */
function recordRefusal(request: NextRequest, session: ApiSession, error: AuthorizationError) {
  if (!isAdmin(session.user) && !isStaffRole(session.user.role)) return;
  const path = request.nextUrl?.pathname ?? new URL(request.url).pathname;
  afterResponse(() =>
    auditAccessDenied(createAuditContext(request, session), {
      method: request.method,
      path,
      reason: error.message,
    }),
  );
}
