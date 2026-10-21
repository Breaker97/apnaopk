import { audit, type AuditContext } from "@/lib/audit";

/**
 * A request a member of the team was refused, in the Activity Log: who tried
 * what, and why it was refused (a team role that does not reach the page, a
 * permission they may not give, a member above them). A refusal is the trace
 * an attempt to climb leaves, so it is recorded like any change — with the
 * member, the time, the method and path (which names the record), and the
 * reason.
 *
 * The same refusal repeated by one member is recorded once a minute, so a
 * script hammering a route cannot bury the log; the first of each burst is
 * what a reviewer needs. The window is per process.
 */

const WINDOW_MS = 60_000;
const MAX_KEYS = 1_000;
const lastRecorded = new Map<string, number>();

/** Whether this refusal is the first of its kind from this member within the window. */
export function shouldRecordAccessDenied(key: string, now = Date.now()): boolean {
  const last = lastRecorded.get(key);
  if (last !== undefined && now - last < WINDOW_MS) return false;
  if (lastRecorded.size >= MAX_KEYS) {
    for (const [seen, at] of lastRecorded) {
      if (now - at >= WINDOW_MS) lastRecorded.delete(seen);
    }
    // Still full of fresh keys: the oldest goes.
    if (lastRecorded.size >= MAX_KEYS) {
      const oldest = lastRecorded.keys().next().value;
      if (oldest !== undefined) lastRecorded.delete(oldest);
    }
  }
  lastRecorded.set(key, now);
  return true;
}

/** Forgets every refusal recorded so far (tests). */
export function resetAccessDeniedWindow(): void {
  lastRecorded.clear();
}

export interface AccessRefusal {
  method: string;
  /** The path asked for, ids and all: the record they tried to reach. */
  path: string;
  /** The refusal as the member was told it. */
  reason: string;
}

/**
 * Records a refusal answered to a signed-in member of the team. `audit()`
 * never throws, so a failed write cannot change the answer.
 */
export async function auditAccessDenied(context: AuditContext, refusal: AccessRefusal) {
  if (!context.userId) return null;
  const method = refusal.method.toUpperCase();
  const path = refusal.path.slice(0, 300);
  if (!shouldRecordAccessDenied(`${context.userId}|${method}|${path}`)) return null;
  const reason = refusal.reason.slice(0, 300);
  return audit(context, {
    action: "ACCESS_DENIED",
    resource: "user",
    resourceId: context.userId,
    ...(context.userEmail ? { resourceName: context.userEmail } : {}),
    changes: { summary: `Refused ${method} ${path}: ${reason}` },
    metadata: { method, path, reason },
    success: false,
    errorMessage: reason,
  });
}
