import { financeSession } from "@/lib/finance/transaction";
/**
 * Audit Logging Utility
 * Helper functions for creating audit log entries
 *
 * Usage:
 * ```typescript
 * // In an API route
 * const auditContext = createAuditContext(request, session);
 * await auditUpdate(auditContext, "user", userId, oldData, newData);
 * ```
 */

import { NextRequest } from "next/server";
import {
  AuditLog,
  AuditAction,
  AuditResource,
  IAuditLog,
} from "@/models/audit-log.model";
import { connectDB } from "./db";
import { resolveClientIp } from "@/lib/api/client-ip";
import { redactCredentialPaths } from "@/lib/settings/credential-fields";
import { resolveActorVendorId } from "@/lib/activity-log/actor-vendor";

/**
 * Context for audit operations
 * Contains information about who is performing the action
 */
export interface AuditContext {
  request?: NextRequest;
  /**
   * Where the change came from when there is no Next request to read it off:
   * the mobile API's handlers see the request's facts, not the request.
   */
  origin?: { ip?: string; requestId?: string; method?: string; path?: string; userAgent?: string };
  userId?: string;
  userEmail?: string;
  userRole?: string;
  /**
   * The store the actor is acting for, when the caller already holds it — a
   * vendor route has the `Vendor` in hand and need not have it looked up. Left
   * unset, `audit()` works it out from the actor (see `resolveActorVendorId`).
   */
  vendorId?: string;
}

/**
 * Parameters for creating an audit log entry
 */
interface AuditParams {
  action: AuditAction;
  resource: AuditResource;
  resourceId?: string;
  resourceName?: string;
  changes?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    fields?: string[];
    summary?: string;
  };
  metadata?: Record<string, unknown>;
  success?: boolean;
  errorMessage?: string;
}

/**
 * Fields that should be redacted from audit logs.
 *
 * These match anywhere in a field name (case-insensitive). They are specific
 * enough that a stray hit costs little, and a substring is what catches the
 * names nobody thought to list (`appsecret`, `resetPasswordToken`).
 */
const SENSITIVE_FIELD_PATTERNS = [
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "accesskey",
  "access_key",
  "privatekey",
  "private_key",
  "credential",
  "bearer",
  "jwt",
  "webhook_secret",
  "webhooksecret",
  "client_secret",
  "clientsecret",
  "encryption_key",
  "encryptionkey",
];

/**
 * Two-word names, matched on the words rather than the spelling, so `x-api-key`
 * and `api key` are caught as well as `apiKey` and `api_key`.
 */
const SENSITIVE_WORD_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["api", "key"],
  ["access", "key"],
  ["private", "key"],
  ["encryption", "key"],
  ["client", "secret"],
  ["webhook", "secret"],
];

/** The words of a field name: `authToken`, `auth_token` and `x-auth-token` are auth + token. */
function fieldWords(fieldName: string): string[] {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** What makes a name containing "session" a credential rather than a setting. */
const SESSION_CREDENTIAL_WORDS = new Set(["id", "token", "cookie", "secret", "key"]);

/**
 * Check if a field name is sensitive
 *
 * `auth`, `session` and `cookie` are not in the list above, because as plain
 * substrings they hid `author`, `authority`, a session's lifetime and a cookie
 * banner's switch — and "who changed the session length, and to what" is a
 * question the log has to be able to answer. They are matched as words instead:
 * `auth` and `authorization` on their own, a session's id, token, cookie or
 * secret (not its length), and a name that ends in `cookie`.
 */
function isSensitiveField(fieldName: string): boolean {
  const lowerName = fieldName.toLowerCase();
  if (SENSITIVE_FIELD_PATTERNS.some((pattern) => lowerName.includes(pattern))) {
    return true;
  }

  const words = fieldWords(fieldName);
  if (
    words.some(
      (word) => word === "auth" || word === "authorization" || word === "authorisation"
    )
  ) {
    return true;
  }
  if (
    SENSITIVE_WORD_PAIRS.some(([first, second]) =>
      words.some((word, index) => word === first && words[index + 1] === second)
    )
  ) {
    return true;
  }
  if (words.some((word) => word === "session" || word === "sessions")) {
    return words.length === 1 || words.some((word) => SESSION_CREDENTIAL_WORDS.has(word));
  }
  const last = words[words.length - 1];
  return last === "cookie" || last === "cookies";
}

/**
 * Recursively sanitize an object by redacting sensitive fields
 */
function sanitizeForAudit(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveField(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (value === null || value === undefined) {
      sanitized[key] = value;
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? sanitizeForAudit(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === "object") {
      sanitized[key] = sanitizeForAudit(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * What one request has already worked out for its audit rows.
 *
 * Keyed on the request object, which every `audit()` call in a request shares,
 * so it needs no scope opened by the route and none of the routes that already
 * audit has to change. (`requestMemo` would not do: it only memoizes inside
 * `withRequestScope`, which only the checkout routes open.)
 */
interface RequestAuditState {
  /** Stands in for a missing `x-request-id`, so a request's rows share one id. */
  requestId?: string;
  /** The store each actor in this request was acting for, looked up once. */
  actorVendors: Map<string, Promise<string | undefined>>;
}

const requestAuditStates = new WeakMap<object, RequestAuditState>();

function requestAuditState(scope: object): RequestAuditState {
  let state = requestAuditStates.get(scope);
  if (!state) {
    state = { actorVendors: new Map() };
    requestAuditStates.set(scope, state);
  }
  return state;
}

/**
 * Extract metadata from a Next.js request
 */
function extractRequestMetadata(
  request?: NextRequest
): Record<string, string> {
  if (!request) return {};

  const ip = resolveClientIp(request.headers) ?? "unknown";
  const state = requestAuditState(request);

  return {
    ip,
    userAgent: request.headers.get("user-agent") || "unknown",
    // Nothing upstream sets `x-request-id`. A fresh id per row would make the id
    // useless for what it is for: telling which rows one request wrote.
    requestId:
      request.headers.get("x-request-id") ||
      (state.requestId ??= crypto.randomUUID()),
    method: request.method,
    path: request.nextUrl.pathname,
  };
}

/** The store the context's actor acts for — one lookup per actor per request. */
function actorVendorIdOf(context: AuditContext): Promise<string | undefined> {
  const { userId, userRole } = context;
  const { actorVendors } = requestAuditState(
    context.request ?? context.origin ?? context
  );
  const key = `${userId ?? ""}:${userRole ?? ""}`;
  let pending = actorVendors.get(key);
  if (!pending) {
    pending = resolveActorVendorId(userId, userRole);
    actorVendors.set(key, pending);
  }
  return pending;
}

/**
 * Calculate the difference between two objects
 * Returns an array of field names that have different values
 */
function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  const fields = new Set<string>();
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const beforeVal = JSON.stringify(before[key]);
    const afterVal = JSON.stringify(after[key]);

    if (beforeVal !== afterVal) {
      fields.add(key);
    }
  }

  return Array.from(fields);
}

/**
 * Create an audit context from a request and session
 *
 * A vendor route that already holds the caller's `Vendor` passes its id, so the
 * row is stamped without a lookup. Every other caller leaves it out and
 * `audit()` resolves it.
 */
export function createAuditContext(
  request: NextRequest,
  session?: { user?: { id?: string; email?: string; role?: string } } | null,
  options?: { vendorId?: string | { toString(): string } | null }
): AuditContext {
  return {
    request,
    userId: session?.user?.id,
    userEmail: session?.user?.email,
    userRole: session?.user?.role,
    ...(options?.vendorId ? { vendorId: String(options.vendorId) } : {}),
  };
}

/**
 * Audit context for work nobody clicked — a cron sweep, a carrier webhook, a
 * queue worker. There is no request and no session, and attributing the change
 * to whichever user happened to trigger the chain would be a lie in the
 * timeline.
 */
export function createSystemAuditContext(): AuditContext {
  return { userId: "system", userRole: "system" };
}

/**
 * Main audit function - creates an audit log entry
 * This is the core function that all other audit functions use
 */
export async function audit(
  context: AuditContext,
  params: AuditParams
): Promise<IAuditLog | null> {
  try {
    await connectDB();

    const {
      action,
      resource,
      resourceId,
      resourceName,
      changes,
      metadata,
      success = true,
      errorMessage,
    } = params;

    const { request, userId, userEmail, userRole } = context;
    const requestMeta = request ? extractRequestMetadata(request) : (context.origin ?? {});
    const actorVendorId = context.vendorId ?? (await actorVendorIdOf(context));

    // Sanitize changes to remove sensitive data
    const sanitizedChanges = changes
      ? {
          before: changes.before
            ? sanitizeForAudit(changes.before)
            : undefined,
          after: changes.after ? sanitizeForAudit(changes.after) : undefined,
          fields: changes.fields,
          summary: changes.summary,
        }
      : undefined;

    const logData = {
      action,
      resource,
      resourceId,
      resourceName,
      // Only a real user's id: `createSystemAuditContext` names its actor
      // "system", which the ObjectId field refused — and a refused write is
      // swallowed below, so every entry made by a cron, a webhook or the
      // carrier cascade silently never reached the timeline.
      userId: userId && /^[0-9a-f]{24}$/i.test(String(userId)) ? userId : undefined,
      userEmail,
      userRole,
      actorVendorId,
      changes: sanitizedChanges,
      metadata: {
        ...requestMeta,
        ...metadata,
      },
      success,
      errorMessage,
    };
    const logEntry = financeSession()
      ? (await AuditLog.create([logData], { session: financeSession() }))[0]!
      : await AuditLog.create(logData);

    return logEntry;
  } catch (error) {
    // Log error but don't throw - audit logging should not break the main flow
    if (financeSession()) throw error;
    console.error("[Audit] Failed to create audit log:", error);
    return null;
  }
}

// ============================================
// Convenience Functions for Common Operations
// ============================================

/**
 * Audit a CREATE action
 */
export async function auditCreate(
  context: AuditContext,
  resource: AuditResource,
  resourceId: string,
  data: Record<string, unknown>,
  resourceName?: string
): Promise<IAuditLog | null> {
  return audit(context, {
    action: "CREATE",
    resource,
    resourceId,
    resourceName,
    changes: {
      after: data,
      summary: `Created ${resource}${resourceName ? `: ${resourceName}` : ""}`,
    },
  });
}

/**
 * Audit an UPDATE action
 */
export async function auditUpdate(
  context: AuditContext,
  resource: AuditResource,
  resourceId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  resourceName?: string
): Promise<IAuditLog | null> {
  const fields = diffObjects(before, after);

  // Skip audit if nothing actually changed
  if (fields.length === 0) {
    return null;
  }

  return audit(context, {
    action: "UPDATE",
    resource,
    resourceId,
    resourceName,
    changes: {
      before,
      after,
      fields,
      summary: `Updated ${resource} fields: ${fields.join(", ")}`,
    },
  });
}

/**
 * Audit a DELETE action
 */
export async function auditDelete(
  context: AuditContext,
  resource: AuditResource,
  resourceId: string,
  data?: Record<string, unknown>,
  resourceName?: string
): Promise<IAuditLog | null> {
  return audit(context, {
    action: "DELETE",
    resource,
    resourceId,
    resourceName,
    changes: data
      ? {
          before: data,
          summary: `Deleted ${resource}${resourceName ? `: ${resourceName}` : ""}`,
        }
      : undefined,
  });
}

/**
 * Audit a role change
 */
export async function auditRoleChange(
  context: AuditContext,
  userId: string,
  oldRole: string,
  newRole: string,
  userEmail?: string
): Promise<IAuditLog | null> {
  return audit(context, {
    action: "ROLE_CHANGE",
    resource: "user",
    resourceId: userId,
    resourceName: userEmail,
    changes: {
      before: { role: oldRole },
      after: { role: newRole },
      fields: ["role"],
      summary: `Changed user role from "${oldRole}" to "${newRole}"`,
    },
  });
}

/**
 * Audit settings changes
 */
export async function auditSettingsChange(
  context: AuditContext,
  section: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Promise<IAuditLog | null> {
  // Diff on the real values so a rotated secret still lists its field; the
  // stored copies are redacted by credential path, on top of the key-name
  // heuristic `audit()` applies to everything.
  const fields = diffObjects(before, after);

  // Skip audit if nothing actually changed
  if (fields.length === 0) {
    return null;
  }

  const scope = section === "multiple" ? undefined : section;
  return audit(context, {
    action: "SETTINGS_CHANGE",
    resource: "settings",
    resourceId: section,
    resourceName: `Settings: ${section}`,
    changes: {
      before: redactCredentialPaths(structuredClone(before), scope),
      after: redactCredentialPaths(structuredClone(after), scope),
      fields,
      summary: `Updated ${section} settings: ${fields.join(", ")}`,
    },
  });
}

/**
 * Audit vendor approval/rejection
 */
export async function auditVendorDecision(
  context: AuditContext,
  vendorId: string,
  decision: "approved" | "rejected" | "suspended",
  vendorName?: string,
  reason?: string
): Promise<IAuditLog | null> {
  const actionMap = {
    approved: "APPROVAL" as AuditAction,
    rejected: "REJECTION" as AuditAction,
    suspended: "SUSPENSION" as AuditAction,
  };

  return audit(context, {
    action: actionMap[decision],
    resource: "vendor",
    resourceId: vendorId,
    resourceName: vendorName,
    changes: {
      after: { status: decision },
      summary: `Vendor ${decision}${reason ? `: ${reason}` : ""}`,
    },
    metadata: reason ? { reason } : undefined,
  });
}

// Order lifecycle events (placed / paid / shipped / refunded / cancelled) live
// in `lib/orders/audit-order.ts` — they are what the admin order Timeline renders, and
// several are emitted from gateway webhooks with no session to build a context
// from.

// Reading the log back lives in `lib/activity-log/list.ts`: one validated, scoped
// query for the admin page, the vendor page and their API routes.
