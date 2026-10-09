import type { NextRequest } from "next/server";
import { isAPIError } from "better-auth/api";
import { USER_ROLES } from "@/config/app.config";
import { CLIENT_IP_HEADER, resolveClientIp } from "@/lib/api/client-ip";
import { audit, createAuditContext, type AuditContext } from "@/lib/audit";
import { connectDB, mongoose } from "@/lib/db";

/**
 * What the Activity Log records about signing in, and about the settings that
 * guard it (docs/ACTIVITY_LOG_PLAN.md §4.1, §6.3).
 *
 * Team accounts — admin, staff, vendor — are logged in full: every sign-in, every
 * failed one, every sign-out. A shopper's ordinary sign-in, sign-out and failed
 * sign-in are not (decision D3: volume, and little to learn from them). What a
 * shopper does to their own *security* is logged like anyone's: a password change
 * or reset, two-factor turned on or off, the account deleted.
 *
 * Nothing here may break a sign-in. Every entry point swallows its own failure.
 */

const TEAM_ROLES: ReadonlySet<string> = new Set([
  USER_ROLES.ADMIN,
  USER_ROLES.STAFF,
  USER_ROLES.SELLER,
  USER_ROLES.VENDOR,
]);

export function isTeamRole(role: unknown): boolean {
  return typeof role === "string" && TEAM_ROLES.has(role);
}

/** The role an account is known by: `admin` wins over every other, as on the session. */
export function primaryRole(user: object): string {
  const { role, roles: rawRoles } = user as { role?: unknown; roles?: unknown };
  const roles = Array.isArray(rawRoles) ? rawRoles.map(String) : [];
  if (role === USER_ROLES.ADMIN || roles.includes(USER_ROLES.ADMIN)) {
    return USER_ROLES.ADMIN;
  }
  return typeof role === "string" && role ? role : USER_ROLES.CUSTOMER;
}

interface AuthUser {
  id: string;
  email?: string | null;
  role?: unknown;
  roles?: unknown;
}

interface AuthSessionPair {
  session: {
    id: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    client?: string | null;
  };
  user: AuthUser;
}

/** The part of Better Auth's hook context this module reads. */
export interface AuthHookContext {
  /** Without the base path: `/sign-in/email`. */
  path?: string;
  request?: Pick<Request, "method" | "url"> | null;
  headers?: Headers | null;
  params?: Record<string, string> | null;
  getSignedCookie?: (name: string, secret: string) => Promise<string | null | undefined>;
  context: {
    /** Set when this request created a session. */
    newSession?: AuthSessionPair | null;
    /** The session the request arrived with. */
    session?: AuthSessionPair | null;
    /** What the endpoint answered: a value, or the `APIError` it threw. */
    returned?: unknown;
    secret?: string;
    createAuthCookie?: (name: string) => { name: string };
    internalAdapter?: {
      findVerificationValue(identifier: string): Promise<{ value: string } | null>;
      findUserById(id: string): Promise<AuthUser | null>;
    };
  };
}

type Origin = NonNullable<AuditContext["origin"]>;

/** Where a request came from, for the row. Better Auth hands hooks headers, not a Next request. */
function originOf(
  ctx: Pick<AuthHookContext, "request" | "headers" | "path">,
  fixed?: { ip?: string | null; userAgent?: string | null },
): Origin {
  const headers = ctx.headers ?? undefined;
  const ip =
    fixed?.ip ??
    headers?.get(CLIENT_IP_HEADER) ??
    (headers ? resolveClientIp(headers) : null);
  const userAgent = fixed?.userAgent ?? headers?.get("user-agent");
  let path = ctx.path ? `/api/auth${ctx.path}` : undefined;
  if (ctx.request?.url) {
    try {
      path = new URL(ctx.request.url).pathname;
    } catch {
      // Keep the path built from the endpoint.
    }
  }
  return {
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(ctx.request?.method ? { method: ctx.request.method } : {}),
    ...(path ? { path } : {}),
    requestId: headers?.get("x-request-id") || crypto.randomUUID(),
  };
}

function actorOf(user: AuthUser, origin: Origin): AuditContext {
  return {
    userId: user.id,
    userEmail: user.email ?? undefined,
    userRole: primaryRole(user),
    origin,
  };
}

function failed(returned: unknown): boolean {
  return isAPIError(returned);
}

// ---------------------------------------------------------------------------
// Better Auth's after-hook
// ---------------------------------------------------------------------------

const TWO_FACTOR_VERIFY = {
  "/two-factor/verify-totp": "an authenticator code",
  "/two-factor/verify-otp": "a one-time code",
  "/two-factor/verify-backup-code": "a backup code",
} as const;

/** The cookie the two-factor plugin keeps the pending challenge in. */
const TWO_FACTOR_COOKIE = "two_factor";

/** Wrong-code answers, as opposed to a bad cookie, a lock, or too many tries. */
const WRONG_CODE = new Set(["INVALID_CODE", "INVALID_BACKUP_CODE"]);

/** Paths the activity-log plugin's hook listens to. */
export function isAuthAuditPath(path: string | undefined): boolean {
  if (!path) return false;
  return (
    path === "/sign-in/email" ||
    path === "/sign-out" ||
    path === "/revoke-session" ||
    path === "/revoke-other-sessions" ||
    path === "/change-password" ||
    path === "/two-factor/generate-backup-codes" ||
    path in TWO_FACTOR_VERIFY ||
    path.startsWith("/callback/")
  );
}

function signInMethod(ctx: AuthHookContext): string {
  const path = ctx.path ?? "";
  if (path in TWO_FACTOR_VERIFY) {
    return `a password and ${TWO_FACTOR_VERIFY[path as keyof typeof TWO_FACTOR_VERIFY]}`;
  }
  if (path.startsWith("/callback/")) return ctx.params?.id ? `their ${ctx.params.id} account` : "a social account";
  return "a password";
}

/**
 * LOGIN. Runs after the two-factor plugin's own hook (the plugin is listed
 * before this one), which matters: on a password step that is only half a
 * sign-in the plugin deletes the session it just made and clears `newSession`,
 * so a two-factor sign-in writes one row — at the code step — and not two.
 * Logging from `session.create` instead would write the half-made session too,
 * and one for every session re-minted when two-factor is turned on or off.
 */
async function recordSignIn(ctx: AuthHookContext): Promise<void> {
  const fresh = ctx.context.newSession;
  if (!fresh || failed(ctx.context.returned)) return;

  // The verify steps also run while signed in, to turn two-factor on: a session
  // came in with the request, and nothing was signed in to.
  if (ctx.path?.startsWith("/two-factor/") && ctx.context.session) return;

  const role = primaryRole(fresh.user);
  if (!isTeamRole(role)) return;

  const email = fresh.user.email ?? "An account";
  await audit(
    // The session row's own address and device: what the account page lists
    // as "your devices", so the log and that list agree.
    actorOf(
      fresh.user,
      originOf(ctx, { ip: fresh.session.ipAddress, userAgent: fresh.session.userAgent }),
    ),
    {
      action: "LOGIN",
      resource: "session",
      resourceId: fresh.session.id,
      resourceName: fresh.user.email ?? undefined,
      changes: { summary: `${email} (${role}) signed in with ${signInMethod(ctx)}.` },
      metadata: { client: fresh.session.client || "web" },
    },
  );
}

/** LOGOUT, for a sign-out, or for the other devices being signed out. */
async function recordSignOut(ctx: AuthHookContext): Promise<void> {
  const current = ctx.context.session;
  if (!current || failed(ctx.context.returned)) return;
  const role = primaryRole(current.user);
  if (!isTeamRole(role)) return;

  const email = current.user.email ?? "An account";
  const scope =
    ctx.path === "/revoke-session"
      ? "one"
      : ctx.path === "/revoke-other-sessions"
        ? "others"
        : "current";
  const summary =
    scope === "one"
      ? `${email} (${role}) signed out one of their devices.`
      : scope === "others"
        ? `${email} (${role}) signed out all their other devices.`
        : `${email} (${role}) signed out.`;

  await audit(actorOf(current.user, originOf(ctx)), {
    action: "LOGOUT",
    resource: "session",
    resourceId: current.session.id,
    resourceName: current.user.email ?? undefined,
    changes: { summary },
    metadata: { scope },
  });
}

/**
 * Better Auth's own `/change-password` is still served — the account pages use
 * `/api/user/change-password` — and a change through it must not skip the log.
 * Everyone's password changes are logged, a shopper's included.
 */
async function recordBuiltInPasswordChange(ctx: AuthHookContext): Promise<void> {
  const current = ctx.context.session;
  if (!current || failed(ctx.context.returned)) return;
  await audit(actorOf(current.user, originOf(ctx)), {
    action: "PASSWORD_CHANGE",
    resource: "user",
    resourceId: current.user.id,
    resourceName: current.user.email ?? undefined,
    changes: { summary: "Changed their own password." },
  });
}

async function recordBackupCodesRegenerated(ctx: AuthHookContext): Promise<void> {
  const current = ctx.context.session;
  if (!current || failed(ctx.context.returned)) return;
  await audit(actorOf(current.user, originOf(ctx)), {
    action: "TWO_FACTOR_CHANGE",
    resource: "user",
    resourceId: current.user.id,
    resourceName: current.user.email ?? undefined,
    changes: { summary: "Generated new two-factor backup codes; the old ones no longer work." },
    metadata: { change: "backup_codes" },
  });
}

/**
 * A wrong code at the second step: the password was right, so the account is
 * the one the pending challenge belongs to. Found the way the plugin finds it,
 * from the signed challenge cookie — not from anything the client sends. A
 * refusal for a bad cookie, a lock, or too many tries is not a wrong guess and
 * is not logged.
 */
async function recordTwoFactorFailure(ctx: AuthHookContext): Promise<void> {
  const error = ctx.context.returned;
  if (!isAPIError(error) || ctx.context.session) return;
  const code = (error.body as { code?: string } | undefined)?.code;
  if (!code || !WRONG_CODE.has(code)) return;

  const { createAuthCookie, secret, internalAdapter } = ctx.context;
  if (!ctx.getSignedCookie || !createAuthCookie || !secret || !internalAdapter) return;

  const challenge = await ctx.getSignedCookie(createAuthCookie(TWO_FACTOR_COOKIE).name, secret);
  if (!challenge) return;
  const pending = await internalAdapter.findVerificationValue(challenge);
  const user = pending ? await internalAdapter.findUserById(pending.value) : null;
  if (!user) return;

  const role = primaryRole(user);
  if (!isTeamRole(role)) return;

  const used = TWO_FACTOR_VERIFY[ctx.path as keyof typeof TWO_FACTOR_VERIFY] ?? "a code";
  const email = user.email ?? "an account";
  // Q2 of the plan: the actor is unknown. The row names the account in
  // `resourceId`, carries no `userId` (so it is never in a vendor's log, and is
  // not written under the owner's name), and the email only as what was tried.
  await audit(
    { userEmail: email, origin: originOf(ctx) },
    {
      action: "LOGIN_FAILED",
      resource: "session",
      resourceId: user.id,
      resourceName: email,
      success: false,
      errorMessage: "Wrong two-factor code",
      changes: {
        summary: `A sign-in to ${role} account ${email} failed at the two-factor step: ${used} was wrong.`,
      },
      metadata: { stage: "two_factor", targetRole: role },
    },
  );
}

/** Better Auth's after-hook body. Never throws: a log line must not fail a sign-in. */
export async function recordAuthEvent(ctx: AuthHookContext): Promise<void> {
  try {
    const path = ctx.path ?? "";
    if (path === "/sign-in/email" || path.startsWith("/callback/")) {
      await recordSignIn(ctx);
    } else if (path in TWO_FACTOR_VERIFY) {
      await recordSignIn(ctx);
      await recordTwoFactorFailure(ctx);
    } else if (path === "/sign-out" || path === "/revoke-session" || path === "/revoke-other-sessions") {
      await recordSignOut(ctx);
    } else if (path === "/change-password") {
      await recordBuiltInPasswordChange(ctx);
    } else if (path === "/two-factor/generate-backup-codes") {
      await recordBackupCodesRegenerated(ctx);
    }
  } catch (error) {
    console.error("[Audit] Could not record an auth event:", error);
  }
}

// ---------------------------------------------------------------------------
// Database hooks and services
// ---------------------------------------------------------------------------

/**
 * TWO_FACTOR_CHANGE, from the user update that flips `twoFactorEnabled`.
 *
 * Logged where Better Auth writes the flag, not at `/two-factor/enable`: with
 * the default options `/enable` only stores a secret, and someone who closes
 * the QR dialog never turned two-factor on. The flag flips at the first good
 * code (`verify-totp`, `verify-otp`) and at `/two-factor/disable`.
 */
export async function auditTwoFactorToggle(
  user: AuthUser & { twoFactorEnabled?: unknown },
  ctx: Pick<AuthHookContext, "request" | "headers" | "path"> | null | undefined,
): Promise<void> {
  try {
    if (!ctx?.path?.startsWith("/two-factor/")) return;
    if (typeof user.twoFactorEnabled !== "boolean") return;
    const enabled = user.twoFactorEnabled;
    await audit(actorOf(user, originOf(ctx)), {
      action: "TWO_FACTOR_CHANGE",
      resource: "user",
      resourceId: user.id,
      resourceName: user.email ?? undefined,
      changes: {
        after: { enabled },
        fields: ["twoFactorEnabled"],
        summary: enabled
          ? "Turned on two-factor sign-in."
          : "Turned off two-factor sign-in.",
      },
      metadata: { change: enabled ? "enabled" : "disabled" },
    });
  } catch (error) {
    console.error("[Audit] Could not record a two-factor change:", error);
  }
}

/**
 * DELETE of a shopper's own account (Q1 of the plan). The row keeps the email
 * and does not depend on the user, who is gone: audit rows survive their user.
 */
export async function auditAccountSelfDeleted(
  user: AuthUser,
  context: AuditContext,
): Promise<void> {
  try {
    const email = user.email ?? "an account";
    await audit(
      { ...context, userId: user.id, userEmail: user.email ?? undefined, userRole: primaryRole(user) },
      {
        action: "DELETE",
        resource: "user",
        resourceId: user.id,
        resourceName: user.email ?? undefined,
        changes: { summary: `${email} deleted their own account.` },
      },
    );
  } catch (error) {
    console.error("[Audit] Could not record an account deletion:", error);
  }
}

/** The audit context for a Better Auth callback that was handed a `Request`. */
export function contextOfRequest(
  request: Pick<Request, "method" | "url" | "headers"> | undefined,
): AuditContext {
  return {
    origin: originOf({ request, headers: request?.headers, path: undefined }),
  };
}

// ---------------------------------------------------------------------------
// The sign-in route
// ---------------------------------------------------------------------------

/**
 * LOGIN_FAILED for a wrong password, when the account is a team account. An
 * address that belongs to no team account is not logged: it is a shopper's
 * typo, or someone guessing, and neither is worth a row (D3).
 *
 * Only the attempt that trips a lock is logged as the lock; the ones refused
 * while it holds never get here, so hammering a locked account cannot flood the
 * log. The account is named in `resourceId` and no actor is claimed — see
 * `recordTwoFactorFailure`.
 */
export async function auditFailedPasswordSignIn(input: {
  request: NextRequest;
  email: string;
  attemptsRemaining: number | null;
  locked: boolean;
  retryAfterSeconds: number;
}): Promise<void> {
  try {
    const email = input.email.trim().toLowerCase();
    await connectDB();
    const db = mongoose.connection.db;
    if (!db) return;
    const user = await db
      .collection("user")
      .findOne({ email }, { projection: { email: 1, role: 1, roles: 1 } });
    if (!user) return;

    const role = primaryRole(user);
    if (!isTeamRole(role)) return;

    const minutes = Math.max(1, Math.ceil(input.retryAfterSeconds / 60));
    const left = input.attemptsRemaining;
    const summary = input.locked
      ? `A sign-in to ${role} account ${email} failed, and the account is locked for ${minutes} minute${minutes === 1 ? "" : "s"} after too many wrong passwords.`
      : `A sign-in to ${role} account ${email} failed: the password was wrong${
          left === null ? "" : `, with ${left} attempt${left === 1 ? "" : "s"} left before the account locks`
        }.`;

    await audit(
      { ...createAuditContext(input.request), userEmail: email },
      {
        action: "LOGIN_FAILED",
        resource: "session",
        resourceId: String(user._id),
        resourceName: email,
        success: false,
        errorMessage: "Wrong password",
        changes: { summary },
        metadata: {
          stage: "password",
          targetRole: role,
          attemptsRemaining: left,
          locked: input.locked,
          ...(input.locked ? { retryAfterSeconds: input.retryAfterSeconds } : {}),
        },
      },
    );
  } catch (error) {
    console.error("[Audit] Could not record a failed sign-in:", error);
  }
}
