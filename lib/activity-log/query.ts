import * as z from "zod";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/config/audit.config";

/**
 * The Activity Log's query string, for the admin page and `/api/admin/audit-logs`
 * alike — and for the vendor's, which reads a narrower slice of it.
 *
 * Runtime-free (zod only), so the list's toolbar can share it. The list screens
 * parse it with `parsePageQuery` and the API with `validateQuery`; both read the
 * same string the same way.
 */

/** Roles a row can have been written under: the user roles, and `system`. */
export const ACTIVITY_LOG_ROLES = [
  "admin",
  "staff",
  "seller",
  "vendor",
  "customer",
  "system",
] as const;

/** A bare list opens on this many days. Every query is bounded by `createdAt`. */
export const ACTIVITY_LOG_DEFAULT_WINDOW_DAYS = 30;

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * A filter value the toolbar can clear. The select sends "all" for "no filter",
 * and an "all" that reached an enum would fail it and take every other param
 * down with it (see `CustomersListView`).
 */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "all" || value === "" ? undefined : value),
    schema.optional(),
  );

const objectId = z.string().regex(OBJECT_ID, "Not a valid id");

export const ActivityLogQuerySchema = z.object({
  page: z.coerce.number().min(1).max(1000).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  /** A named period or a picked day range; see `lib/date-filter.ts`. */
  date: z.string().max(40).optional(),
  /**
   * Who acted. An admin types an email — or arrives with an id from a staff
   * member's page — and the vendor's team-member picker sends an id.
   */
  actor: clearable(z.string().trim().min(1).max(254)),
  role: clearable(z.enum(ACTIVITY_LOG_ROLES)),
  /** Whose team acted. Admin only: a vendor's own scope is never read from here. */
  vendor: clearable(objectId),
  action: clearable(z.enum(AUDIT_ACTIONS)),
  resource: clearable(z.enum(AUDIT_RESOURCES)),
  /** What the action touched, with `resource`: a record's own history. */
  resourceId: clearable(z.string().trim().min(1).max(100)),
  outcome: clearable(z.enum(["success", "failed"])),
  /**
   * One person's whole history, from a staff member's page: what they did, and
   * what was done to their account (changes, and sign-ins that failed on it).
   * Admin only, like `resourceId`.
   */
  member: clearable(objectId),
  /** With `member`, one half of it: `by` what they did, `on` their account. */
  side: clearable(z.enum(["by", "on"])),
  /** The vendor's two lists: its owner's own actions, and its staff's. */
  tab: clearable(z.enum(["mine", "staff"])),
});

export type ActivityLogQuery = z.infer<typeof ActivityLogQuerySchema>;
