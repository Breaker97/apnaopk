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
import { redactCredentialPaths } from "@/lib/settings/credential-fields";

/**
 * Context for audit operations
 * Contains information about who is performing the action
 */
export interface AuditContext {
  request?: NextRequest;
  userId?: string;
  userEmail?: string;
  userRole?: string;
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
 * Fields that should be redacted from audit logs
 * These patterns match field names (case-insensitive)
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
  "auth",
  "bearer",
  "jwt",
  "session",
  "cookie",
  "webhook_secret",
  "webhooksecret",
  "client_secret",
  "clientsecret",
  "encryption_key",
  "encryptionkey",
];

/**
 * Check if a field name is sensitive
 */
function isSensitiveField(fieldName: string): boolean {
  const lowerName = fieldName.toLowerCase();
  return SENSITIVE_FIELD_PATTERNS.some((pattern) =>
    lowerName.includes(pattern.toLowerCase())
  );
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
 * Extract metadata from a Next.js request
 */
function extractRequestMetadata(
  request?: NextRequest
): Record<string, string> {
  if (!request) return {};

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown";

  return {
    ip,
    userAgent: request.headers.get("user-agent") || "unknown",
    requestId: request.headers.get("x-request-id") || crypto.randomUUID(),
    method: request.method,
    path: request.nextUrl.pathname,
  };
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
 */
export function createAuditContext(
  request: NextRequest,
  session?: { user?: { id?: string; email?: string; role?: string } } | null
): AuditContext {
  return {
    request,
    userId: session?.user?.id,
    userEmail: session?.user?.email,
    userRole: session?.user?.role,
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
    const requestMeta = extractRequestMetadata(request);

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

    const logEntry = await AuditLog.create({
      action,
      resource,
      resourceId,
      resourceName,
      userId: userId || undefined,
      userEmail,
      userRole,
      changes: sanitizedChanges,
      metadata: {
        ...requestMeta,
        ...metadata,
      },
      success,
      errorMessage,
    });

    return logEntry;
  } catch (error) {
    // Log error but don't throw - audit logging should not break the main flow
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
// in `lib/audit-order.ts` — they are what the admin order Timeline renders, and
// several are emitted from gateway webhooks with no session to build a context
// from.

// ============================================
// Query Functions for Audit Logs
// ============================================

/**
 * Query audit logs with filters
 */
export async function queryAuditLogs(filters: {
  userId?: string;
  resource?: AuditResource;
  resourceId?: string;
  action?: AuditAction;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  skip?: number;
}): Promise<{ logs: IAuditLog[]; total: number }> {
  await connectDB();

  const query: Record<string, unknown> = {};

  if (filters.userId) query.userId = filters.userId;
  if (filters.resource) query.resource = filters.resource;
  if (filters.resourceId) query.resourceId = filters.resourceId;
  if (filters.action) query.action = filters.action;
  if (typeof filters.success === "boolean") query.success = filters.success;

  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) {
      (query.createdAt as Record<string, Date>).$gte = filters.startDate;
    }
    if (filters.endDate) {
      (query.createdAt as Record<string, Date>).$lte = filters.endDate;
    }
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip(filters.skip || 0)
      .limit(filters.limit || 50)
      .lean(),
    AuditLog.countDocuments(query),
  ]);

  return { logs: logs as IAuditLog[], total };
}
