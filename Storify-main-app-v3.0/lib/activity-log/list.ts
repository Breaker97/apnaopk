import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { AuditLog } from "@/models/audit-log.model";
import { User } from "@/models/user.model";
import { Vendor } from "@/models/vendor.model";
import { countForQuery, listResult, type ListResult } from "@/lib/api/list-query";
import { resolveDateFilter } from "@/lib/date-filter";
import {
  ACTIVITY_LOG_DEFAULT_WINDOW_DAYS,
  type ActivityLogQuery,
} from "@/lib/activity-log/query";
import type { AuditAction, AuditResource } from "@/config/audit.config";

/**
 * The Activity Log's reads, for the admin page, the vendor page and their API
 * routes. Following `fetchAdminOrderList` and `fetchAdminCustomerList`: the
 * endpoint and the rendered page call the same function, so they cannot answer
 * the same query string differently.
 *
 * The scope is the one thing a caller cannot talk its way out of. An admin reads
 * everything; a vendor reads rows whose `actorVendorId` is its own store, and
 * nothing in the query string can widen that.
 */

export type ActivityLogScope =
  | { kind: "admin" }
  | {
      kind: "vendor";
      /** From the server-resolved `Vendor`, never from the request. */
      vendorId: string;
      /** The owner's user id: "My activity" is theirs, "Staff activity" is everyone else's. */
      ownerUserId: string;
      tab: "mine" | "staff";
    };

/** What a single entry's scope needs: the vendor tab rule comes from the row itself. */
export type ActivityLogEntryScope =
  | { kind: "admin" }
  | {
      kind: "vendor";
      vendorId: string;
      ownerUserId: string;
      /** Whether the caller holds `view_staff`, which "Staff activity" rows need. */
      canViewStaff: boolean;
    };

/** A list row. Plain values only: it crosses the server → client boundary as is. */
export interface ActivityLogRow {
  _id: string;
  createdAt: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId?: string;
  resourceName?: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  /** The store whose team acted, when there is one. */
  actorVendorId?: string;
  actorVendorName?: string;
  /** `changes.summary`: one full sentence, and all the list shows of a change. */
  summary?: string;
  fields?: string[];
  ip?: string;
  success: boolean;
  /** Admin only. */
  errorMessage?: string;
}

/** One entry in full: a row plus its before/after values and request details. */
export interface ActivityLogEntry extends ActivityLogRow {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  userAgent?: string;
  /**
   * Admin: the whole free-form `metadata` (method, path, request id, and whatever
   * the event recorded). Vendor: only `ip` and `userAgent`. It is an allowlist
   * because `metadata` is free-form — any key an event adds later would
   * otherwise reach vendors by default.
   */
  metadata?: Record<string, unknown>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Everything the list shows, and not `changes.before`/`after`: only the detail loads those. */
const LIST_PROJECTION = [
  "action",
  "resource",
  "resourceId",
  "resourceName",
  "userId",
  "userEmail",
  "userRole",
  "actorVendorId",
  "success",
  "errorMessage",
  "createdAt",
  "changes.summary",
  "changes.fields",
  "metadata.ip",
].join(" ");

/** The window a query reads: picked, named, `all`, or — by default — the last 30 days. */
export function activityLogDateWindow(
  date: string | undefined,
  now: Date = new Date(),
): { from?: Date; to?: Date } {
  if (date === "all") return {};
  const picked = resolveDateFilter(date, now);
  if (picked) return picked;
  return {
    from: new Date(now.getTime() - ACTIVITY_LOG_DEFAULT_WINDOW_DAYS * DAY_MS),
  };
}

/** Who an admin's `actor` filter stands for: a user, or — for a deleted one — an email snapshot. */
export interface ResolvedActor {
  userId?: string;
  userEmail?: string;
}

/**
 * What a person's account can be the subject of: changes to the member (`user`)
 * and the sign-ins made to it (`session`, where a failed one names the account
 * in `resourceId`). A successful sign-in's `resourceId` is a session id, not the
 * account, so a member's own sign-ins fall on the `by` side only.
 */
const MEMBER_ACCOUNT_RESOURCES: AuditResource[] = ["user", "session"];

/** A member's history: rows they wrote, rows about their account, or either. */
function memberFilter(member: string, side?: "by" | "on"): Record<string, unknown> {
  const by = { userId: member };
  const on = { resource: { $in: MEMBER_ACCOUNT_RESOURCES }, resourceId: member };
  if (side === "by") return by;
  if (side === "on") return on;
  return { $or: [by, on] };
}

/**
 * The Mongo filter for a query under a scope. Pure, so the scoping rules are
 * testable without a database.
 *
 * Vendor scope ignores `vendor`, `role`, `outcome` and `resourceId`: it forces
 * `actorVendorId` to its own store and splits on the owner's user id. The
 * `actor` filter is a team-member pick there, honoured on "Staff activity" only.
 */
export function buildActivityLogFilter(
  query: Pick<
    ActivityLogQuery,
    | "date"
    | "role"
    | "vendor"
    | "action"
    | "resource"
    | "resourceId"
    | "outcome"
    | "member"
    | "side"
  >,
  scope: ActivityLogScope,
  actor?: ResolvedActor,
  now: Date = new Date(),
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const window = activityLogDateWindow(query.date, now);
  if (window.from || window.to) {
    and.push({
      createdAt: {
        ...(window.from ? { $gte: window.from } : {}),
        ...(window.to ? { $lte: window.to } : {}),
      },
    });
  }

  if (query.action) and.push({ action: query.action });
  if (query.resource) and.push({ resource: query.resource });

  if (scope.kind === "vendor") {
    and.push({ actorVendorId: scope.vendorId });
    if (scope.tab === "mine") {
      and.push({ userId: scope.ownerUserId });
    } else {
      and.push({ userId: { $ne: scope.ownerUserId } });
      if (actor?.userId) and.push({ userId: actor.userId });
    }
  } else {
    if (query.resourceId) and.push({ resourceId: query.resourceId });
    if (query.role) and.push({ userRole: query.role });
    if (query.vendor) and.push({ actorVendorId: query.vendor });
    if (query.outcome) and.push({ success: query.outcome === "success" });
    if (query.member) and.push(memberFilter(query.member, query.side));
    if (actor?.userId) and.push({ userId: actor.userId });
    else if (actor?.userEmail) and.push({ userEmail: actor.userEmail });
  }

  return and.length > 0 ? { $and: and } : {};
}

/**
 * An admin's `actor` filter. An id (arriving from a staff member's page) is used
 * as is. An email is looked up, and a user who no longer exists still matches by
 * the email each of their rows kept.
 */
async function resolveAdminActor(
  actor: string | undefined,
): Promise<ResolvedActor | undefined> {
  if (!actor) return undefined;
  if (OBJECT_ID.test(actor)) return { userId: actor };

  const email = actor.trim().toLowerCase();
  const user = await User.findOne({ email }).select("_id").lean();
  return user ? { userId: String(user._id) } : { userEmail: email };
}

/** A vendor's team-member pick: a valid id, or nothing. */
function resolveVendorActor(actor: string | undefined): ResolvedActor | undefined {
  return actor && OBJECT_ID.test(actor) ? { userId: actor } : undefined;
}

/** Store names for the rows that name one, in one query. */
async function loadVendorNames(
  vendorIds: Iterable<string>,
): Promise<Map<string, string>> {
  const ids = [...new Set(vendorIds)];
  if (ids.length === 0) return new Map();
  const vendors = await Vendor.find({ _id: { $in: ids } })
    .select("storeName")
    .lean();
  return new Map(vendors.map((vendor) => [String(vendor._id), vendor.storeName]));
}

interface AuditLogLeanRow {
  _id: unknown;
  action: AuditAction;
  resource: AuditResource;
  resourceId?: string;
  resourceName?: string;
  userId?: unknown;
  userEmail?: string;
  userRole?: string;
  actorVendorId?: unknown;
  success?: boolean;
  errorMessage?: string;
  createdAt: Date;
  changes?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    fields?: string[];
    summary?: string;
  };
  metadata?: Record<string, unknown>;
}

function toRow(
  row: AuditLogLeanRow,
  vendorNames: Map<string, string>,
  scope: { kind: "admin" | "vendor" },
): ActivityLogRow {
  const actorVendorId = row.actorVendorId ? String(row.actorVendorId) : undefined;
  const ip = row.metadata?.ip;
  return {
    _id: String(row._id),
    createdAt: row.createdAt.toISOString(),
    action: row.action,
    resource: row.resource,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    userId: row.userId ? String(row.userId) : undefined,
    userEmail: row.userEmail,
    userRole: row.userRole,
    actorVendorId,
    actorVendorName: actorVendorId ? vendorNames.get(actorVendorId) : undefined,
    summary: row.changes?.summary,
    fields: row.changes?.fields,
    ip: typeof ip === "string" ? ip : undefined,
    success: row.success !== false,
    ...(scope.kind === "admin" ? { errorMessage: row.errorMessage } : {}),
  };
}

export type ActivityLogListQuery = Pick<
  ActivityLogQuery,
  | "page"
  | "limit"
  | "date"
  | "actor"
  | "role"
  | "vendor"
  | "action"
  | "resource"
  | "resourceId"
  | "outcome"
  | "member"
  | "side"
>;

export async function fetchActivityLogList(
  query: ActivityLogListQuery,
  scope: ActivityLogScope,
): Promise<ListResult<ActivityLogRow>> {
  await connectDB();

  const { page, limit } = query;
  const actor =
    scope.kind === "admin"
      ? await resolveAdminActor(query.actor)
      : resolveVendorActor(query.actor);
  const filter = buildActivityLogFilter(query, scope, actor);

  const [rows, total] = await Promise.all([
    AuditLog.find(filter)
      .select(LIST_PROJECTION)
      // `_id` breaks the ties between rows written in the same millisecond. The
      // indexes end in it too, so this stays an index walk and not a sort.
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<AuditLogLeanRow[]>(),
    countForQuery(AuditLog, filter),
  ]);

  const vendorNames =
    scope.kind === "admin"
      ? await loadVendorNames(
          rows.flatMap((row) => (row.actorVendorId ? [String(row.actorVendorId)] : [])),
        )
      : new Map<string, string>();

  return listResult(
    rows.map((row) => toRow(row, vendorNames, scope)),
    page,
    limit,
    total,
  );
}

/**
 * One entry in full, or null when it does not exist or is not the caller's to
 * read. A vendor's miss and a vendor's refusal look the same on purpose: an id
 * that belongs to another store must not be distinguishable from one that
 * belongs to nobody.
 */
export async function fetchActivityLogEntry(
  id: string,
  scope: ActivityLogEntryScope,
): Promise<ActivityLogEntry | null> {
  if (!OBJECT_ID.test(id)) return null;
  await connectDB();

  const row = await AuditLog.findOne(
    scope.kind === "vendor" ? { _id: id, actorVendorId: scope.vendorId } : { _id: id },
  ).lean<AuditLogLeanRow | null>();
  if (!row) return null;

  if (scope.kind === "vendor") {
    const actedByOwner = String(row.userId ?? "") === scope.ownerUserId;
    if (!actedByOwner && !scope.canViewStaff) return null;
  }

  const vendorNames =
    scope.kind === "admin" && row.actorVendorId
      ? await loadVendorNames([String(row.actorVendorId)])
      : new Map<string, string>();

  const metadata = row.metadata ?? {};
  return {
    ...toRow(row, vendorNames, scope),
    before: row.changes?.before,
    after: row.changes?.after,
    userAgent: typeof metadata.userAgent === "string" ? metadata.userAgent : undefined,
    metadata:
      scope.kind === "admin"
        ? metadata
        : {
            ...(typeof metadata.ip === "string" ? { ip: metadata.ip } : {}),
            ...(typeof metadata.userAgent === "string"
              ? { userAgent: metadata.userAgent }
              : {}),
          },
  };
}

/** A person who appears in a vendor's log: the team-member picker's options. */
export interface ActivityLogActor {
  userId: string;
  email?: string;
  role?: string;
}

/**
 * Who acted for a vendor within the date window, built from the log rather than
 * from today's staff list: a team member who was deleted last week still has
 * rows, and still needs to be selectable. The owner is left out — "My activity"
 * is theirs.
 */
export async function fetchVendorLogActors(
  vendorId: string,
  ownerUserId: string,
  date?: string,
): Promise<ActivityLogActor[]> {
  await connectDB();

  const window = activityLogDateWindow(date);
  // An aggregation does not cast: a string id here would match nothing.
  const rows = await AuditLog.aggregate<{
    _id: unknown;
    email?: string;
    role?: string;
  }>([
    {
      $match: {
        actorVendorId: new Types.ObjectId(vendorId),
        userId: { $ne: new Types.ObjectId(ownerUserId) },
        ...(window.from || window.to
          ? {
              createdAt: {
                ...(window.from ? { $gte: window.from } : {}),
                ...(window.to ? { $lte: window.to } : {}),
              },
            }
          : {}),
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$userId",
        email: { $first: "$userEmail" },
        role: { $first: "$userRole" },
      },
    },
    { $limit: 100 },
  ]);

  return rows.flatMap((row) =>
    row._id ? [{ userId: String(row._id), email: row.email, role: row.role }] : [],
  );
}
