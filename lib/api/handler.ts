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
}

interface ApiContext<TParams> {
  request: NextRequest;
  /** Awaited dynamic route params (empty object for static routes). */
  params: TParams;
  session: ApiSession | null;
  /** Present only for auth: "admin-or-staff". */
  staff?: StaffGrants;
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
    try {
      let session: ApiSession | null = null;
      let staff: StaffGrants | undefined;

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
            };
          }
        }
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
      });
    } catch (error) {
      return handleApiError(error);
    }
  };
}
