import { audit, type AuditContext } from "@/lib/audit";

/**
 * Audit events for the people on a team: a vendor's staff or the platform's own
 * staff and administrators added, given other permissions or another scope,
 * switched off, edited and removed, and an invitation sent to any of them. A
 * vendor's route and the admin's route call the same builders, so a member reads
 * the same in the log whoever owns them.
 *
 * Three properties the callers rely on:
 *
 * 1. **Rows come from what moved, never from the request.** The staff form
 *    posts every field back on every save, so a save that changed one thing
 *    arrives looking like a save of everything. `staffAuditSnapshot` reads the
 *    stored member before and after, and a row is written only for a kind of
 *    change that differs between the two.
 * 2. **One row per kind of change.** What a member may do (permissions), what
 *    data they may reach (stores, locations, fulfillment regions), whether they
 *    may work at all (status) and who they are (name, phone, ...) are different
 *    questions in the log, and "who changed this person's access" must be a
 *    filter, not a search through a generic update. A save that touches two
 *    kinds writes two rows; one that touches none writes nothing.
 * 3. **Only allowlisted fields are ever read.** The snapshot names its fields
 *    one by one, so a whole user document — password hash and all — cannot end
 *    up in a row by being passed along. An invite row carries the invitee's
 *    address and nothing of the link they were sent.
 *
 * `audit()` never throws, so none of these can fail the request that called it.
 */

/** The member a row is about. The email is the stable handle; names change. */
interface StaffMember {
  userId: string;
  name?: string | null;
  email?: string | null;
}

/** What can be changed about a team member, in the form the diff compares. */
interface StaffAuditSnapshot {
  name: string;
  phone: string;
  /** The account's status: active, inactive or banned. */
  status: string;
  /** The staff profile's own switch, separate from the account status. */
  isActive: boolean;
  permissions: string[];
  /** Whose data the member may reach: stores, locations and fulfillment regions. */
  vendorIds: string[];
  locationIds: string[];
  fulfillmentRegions: string[];
  department: string;
  jobTitle: string;
  startDate: string;
  notes: string;
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** A date as the day it names; the form only ever picks a day. */
function dayOf(value: unknown): string {
  if (!value) return "";
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/** Each permission once, in a fixed order, so the same set always compares equal. */
function permissionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string")),
  ).sort();
}

/** Ids and names as plain, unique, ordered strings, whatever type the driver hands back. */
function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)),
  ).sort();
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** A few names read well in a list; a preset's worth do not. The row keeps them all. */
function namesOf(items: string[], shown = 5): string {
  return items.length <= shown
    ? items.join(", ")
    : `${items.slice(0, shown).join(", ")} and ${items.length - shown} more`;
}

function labelOf({ userId, name, email }: StaffMember): string {
  const shownName = text(name);
  if (shownName && email) return `${shownName} (${email})`;
  return shownName || email || userId;
}

function targetOf(member: StaffMember) {
  return {
    resourceId: member.userId,
    resourceName: member.email || undefined,
  };
}

/**
 * The fields that can change, read off a member as stored. Blank and absent
 * count as the same thing, so a form echoing an empty box back is not a change.
 * Only these fields are ever read, so what is passed in may be a whole document.
 */
export function staffAuditSnapshot(
  user: { name?: unknown; phone?: unknown; status?: unknown },
  profile: {
    isActive?: unknown;
    permissions?: unknown;
    vendorIds?: unknown;
    locationIds?: unknown;
    fulfillmentRegions?: unknown;
    department?: unknown;
    jobTitle?: unknown;
    startDate?: unknown;
    notes?: unknown;
  },
): StaffAuditSnapshot {
  return {
    name: text(user.name),
    phone: text(user.phone),
    status: text(user.status) || "active",
    isActive: profile.isActive !== false,
    permissions: permissionList(profile.permissions),
    vendorIds: idList(profile.vendorIds),
    locationIds: idList(profile.locationIds),
    fulfillmentRegions: idList(profile.fulfillmentRegions),
    department: text(profile.department),
    jobTitle: text(profile.jobTitle),
    startDate: dayOf(profile.startDate),
    notes: text(profile.notes),
  };
}

/** Whose account a row is about: staff, or an administrator of the platform. */
type TeamAccount = "staff" | "administrator";

/**
 * A team member was added: by a vendor, to its own staff, or by an admin, to the
 * platform's staff or its administrators. An administrator holds no staff
 * permissions or scope, so their row carries none.
 */
export function auditStaffCreated(
  context: AuditContext,
  member: { userId: string; name: string; email: string },
  details: {
    status: string;
    account?: TeamAccount;
    isActive?: boolean;
    permissions?: unknown;
    department?: string | null;
    /** The stores they work for, and the locations and regions they are limited to. */
    vendorIds?: unknown;
    locationIds?: unknown;
    fulfillmentRegions?: unknown;
    /** The address already had a customer account, which was given a team role. */
    fromCustomer?: boolean;
  },
) {
  const account = details.account ?? "staff";
  const permissions = permissionList(details.permissions);
  const department = text(details.department);
  const scope = {
    vendorIds: idList(details.vendorIds),
    locationIds: idList(details.locationIds),
    fulfillmentRegions: idList(details.fulfillmentRegions),
  };
  const given = Object.fromEntries(
    Object.entries(scope).filter(([, list]) => list.length > 0),
  );
  const origin = details.fromCustomer ? " from an existing customer account" : "";

  return audit(context, {
    action: "CREATE",
    resource: "user",
    ...targetOf(member),
    changes: {
      after:
        account === "administrator"
          ? {
              name: member.name,
              email: member.email,
              role: "admin",
              status: details.status,
              ...(department ? { department } : {}),
            }
          : {
              name: member.name,
              email: member.email,
              role: "staff",
              status: details.status,
              isActive: details.isActive !== false,
              permissions,
              ...(department ? { department } : {}),
              ...given,
            },
      summary:
        account === "administrator"
          ? `Added administrator ${labelOf(member)}${origin}`
          : `Added staff member ${labelOf(member)} with ${plural(
              permissions.length,
              "permission",
            )}${origin}`,
    },
    ...(details.fromCustomer ? { metadata: { convertedFromCustomer: true } } : {}),
  });
}

/** The details a vendor can edit, and how the summary names each. */
const DETAIL_LABELS = {
  name: "name",
  phone: "phone",
  department: "department",
  jobTitle: "job title",
  startDate: "start date",
  notes: "notes",
} as const;

type DetailField = keyof typeof DETAIL_LABELS;

/**
 * Details whose value never goes into a row. Notes are free text, a private
 * remark about a person; a phone number is personal data. The log outlives the
 * account it is about, and "who changed it" is answered without the value, so
 * the row names the field in `fields` and the summary and keeps the old and the
 * new value out of `before` and `after`.
 */
const UNRECORDED_DETAILS: readonly DetailField[] = ["notes", "phone"];

/**
 * The scope a platform member can be given, and how a summary names each. Stores
 * and locations are opaque ids, so a summary counts them; a region is a name a
 * reader can use, so it is listed. The row keeps every id either way.
 */
const SCOPE_LABELS = {
  vendorIds: { heading: "vendors", byName: false },
  locationIds: { heading: "locations", byName: false },
  fulfillmentRegions: { heading: "fulfillment regions", byName: true },
} as const;

type ScopeField = keyof typeof SCOPE_LABELS;

/** What moved in one scope list, as the summary says it. */
function scopeMoves(field: ScopeField, before: string[], after: string[]): string {
  const { heading, byName } = SCOPE_LABELS[field];
  const show = (items: string[]) =>
    byName ? namesOf(items) : String(items.length);
  const added = after.filter((item) => !before.includes(item));
  const removed = before.filter((item) => !after.includes(item));
  const moves = [
    added.length > 0 ? `added ${show(added)}` : "",
    removed.length > 0 ? `removed ${show(removed)}` : "",
  ].filter(Boolean);
  return `${heading} ${moves.join(", ")}`;
}

/**
 * A team member's details were saved, by a vendor or by an admin. Writes a row
 * for each kind of change that actually differs between `before` and `after`,
 * in the order a reviewer cares about them: access first (permissions, then
 * scope), then status, then details.
 */
export async function auditStaffUpdated(
  context: AuditContext,
  member: { userId: string; email?: string | null },
  before: StaffAuditSnapshot,
  after: StaffAuditSnapshot,
): Promise<void> {
  const target = targetOf(member);
  const who = labelOf({ ...member, name: after.name });

  const added = after.permissions.filter(
    (permission) => !before.permissions.includes(permission),
  );
  const removed = before.permissions.filter(
    (permission) => !after.permissions.includes(permission),
  );
  if (added.length > 0 || removed.length > 0) {
    const moves = [
      added.length > 0 ? `added ${namesOf(added)}` : "",
      removed.length > 0 ? `removed ${namesOf(removed)}` : "",
    ].filter(Boolean);
    await audit(context, {
      action: "PERMISSION_CHANGE",
      resource: "user",
      ...target,
      changes: {
        before: { permissions: before.permissions },
        after: { permissions: after.permissions },
        fields: ["permissions"],
        summary: `Changed permissions for ${who}: ${moves.join("; ")}`,
      },
    });
  }

  const scopeChanged = (Object.keys(SCOPE_LABELS) as ScopeField[]).filter(
    (field) => before[field].join("\n") !== after[field].join("\n"),
  );
  if (scopeChanged.length > 0) {
    const pick = (snapshot: StaffAuditSnapshot) =>
      Object.fromEntries(scopeChanged.map((field) => [field, snapshot[field]]));
    await audit(context, {
      action: "PERMISSION_CHANGE",
      resource: "user",
      ...target,
      changes: {
        before: pick(before),
        after: pick(after),
        fields: scopeChanged,
        summary: `Changed the access scope of ${who}: ${scopeChanged
          .map((field) => scopeMoves(field, before[field], after[field]))
          .join("; ")}`,
      },
    });
  }

  const switchChanged = before.isActive !== after.isActive;
  const statusChanged = before.status !== after.status;
  if (switchChanged || statusChanged) {
    const said: string[] = [];
    if (switchChanged) {
      said.push(
        `${after.isActive ? "Reactivated" : "Deactivated"} staff member ${who}`,
      );
    }
    if (statusChanged) {
      said.push(
        `${
          switchChanged
            ? "changed their account status"
            : `Changed the account status of ${who}`
        } from ${before.status} to ${after.status}`,
      );
    }
    await audit(context, {
      action: "STATUS_CHANGE",
      resource: "user",
      ...target,
      changes: {
        before: {
          ...(statusChanged ? { status: before.status } : {}),
          ...(switchChanged ? { isActive: before.isActive } : {}),
        },
        after: {
          ...(statusChanged ? { status: after.status } : {}),
          ...(switchChanged ? { isActive: after.isActive } : {}),
        },
        fields: [
          ...(statusChanged ? ["status"] : []),
          ...(switchChanged ? ["isActive"] : []),
        ],
        summary: said.join(" and "),
      },
    });
  }

  const changed = (Object.keys(DETAIL_LABELS) as DetailField[]).filter(
    (field) => before[field] !== after[field],
  );
  if (changed.length > 0) {
    const recorded = changed.filter(
      (field) => !UNRECORDED_DETAILS.includes(field),
    );
    const pick = (snapshot: StaffAuditSnapshot) =>
      recorded.length > 0
        ? Object.fromEntries(recorded.map((field) => [field, snapshot[field]]))
        : undefined;
    await audit(context, {
      action: "UPDATE",
      resource: "user",
      ...target,
      changes: {
        before: pick(before),
        after: pick(after),
        fields: changed,
        summary: `Updated details of ${who}: ${changed
          .map((field) => DETAIL_LABELS[field])
          .join(", ")}`,
      },
    });
  }
}

/**
 * A team member was removed, by a vendor or by an admin. `accountRemoved` is
 * false for the legacy profile that works for several stores: this store let
 * them go, and the account stays with the others. An administrator held no staff
 * permissions, so their row names none.
 */
export function auditStaffRemoved(
  context: AuditContext,
  member: StaffMember,
  details: {
    permissions?: unknown;
    isActive?: boolean;
    accountRemoved: boolean;
    account?: TeamAccount;
  },
) {
  const who = labelOf(member);
  const administrator = details.account === "administrator";
  const noun = administrator ? "administrator" : "staff member";

  return audit(context, {
    action: "DELETE",
    resource: "user",
    ...targetOf(member),
    changes: {
      before: {
        name: text(member.name) || undefined,
        email: member.email || undefined,
        role: administrator ? "admin" : "staff",
        ...(administrator
          ? {}
          : {
              isActive: details.isActive !== false,
              permissions: permissionList(details.permissions),
            }),
      },
      summary: details.accountRemoved
        ? `Removed ${noun} ${who}; their account is now a customer account`
        : `Removed ${noun} ${who} from the store`,
    },
    metadata: { accountRemoved: details.accountRemoved },
  });
}

/**
 * The team's names, emails and phone numbers leaving as a CSV file. The row is
 * the only record that a copy was taken, and by whom, so it says how many people
 * the file holds and what narrowed it — never the people themselves.
 */
export function auditStaffExported(
  context: AuditContext,
  details: {
    rowCount: number;
    filters: { search?: string; status?: string };
  },
) {
  // The search box is free text from a query string: capped, so one row cannot
  // carry a page of it.
  const filters = Object.fromEntries(
    Object.entries(details.filters)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([key, value]) => [key, value.slice(0, 60)]),
  );
  const narrowedBy = Object.entries(filters).map(
    ([key, value]) => `${key} "${value}"`,
  );

  return audit(context, {
    action: "EXPORT",
    resource: "user",
    changes: {
      summary: `Exported ${plural(details.rowCount, "team member")} to CSV${
        narrowedBy.length > 0 ? ` (${narrowedBy.join(", ")})` : ""
      }`,
    },
    metadata: { format: "csv", rowCount: details.rowCount, filters },
  });
}

/**
 * An invitation emailed to a team member, by the admin or by a vendor. Written
 * only once the email has gone out. It names the address and nothing of the
 * link: the link signs the invitee in to set a password, and the log is read by
 * far more people than the invitee.
 */
export function auditStaffInvited(
  context: AuditContext,
  member: { userId: string; email: string },
  account: TeamAccount,
) {
  return audit(context, {
    action: "INVITE_SENT",
    resource: "user",
    ...targetOf(member),
    changes: {
      summary: `Sent an invitation email to ${member.email} to set up their ${account} account`,
    },
  });
}
