import { Types } from "mongoose";
import * as z from "zod";
import { AdminProfile, StaffProfile } from "@/models";
import { TeamRole } from "@/models/team-role.model";
import { USER_ROLES } from "@/config/app.config";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import {
  ADMIN_AREA_PERMISSIONS,
  ALL_TEAM_PERMISSIONS,
  BUILT_IN_TEAM_ROLE_KEYS,
  isOwnerOnlyPermission,
} from "@/config/team-permissions.config";
import type { StaffPermission } from "@/config/permissions.config";
import {
  adminProfileTeamFields,
  grantRefusal,
  isBelowTeamAccess,
  resolveTeamAccess,
  sanitizeTeamPermissions,
  staffProfileTeamFields,
  teamAccessFromProfile,
  teamHasAny,
  type TeamAccess,
  type TeamGrant,
} from "@/lib/access/team-permissions";
import { findTeamRole } from "@/lib/access/team-role-store";
import { isStaffRole } from "@/lib/access/staff-role";

/**
 * A team member's role, as the Team form saves it (POST, PUT
 * /api/admin/staff): which role, what they hold on top of it, what is taken
 * away — never more than the person saving may give, never a role their own
 * role may not give, and never on their own account.
 */

/** The role fields the Team form may send (zod shape, merged into the routes' schemas). */
export const MemberRoleInputShape = {
  teamRoleId: z.string().max(64).nullable().optional(),
  teamExtraPermissions: z.array(z.string().max(64)).max(300).optional(),
  teamRevokedPermissions: z.array(z.string().max(64)).max(300).optional(),
};

export interface MemberRoleInput {
  teamRoleId?: string | null;
  teamExtraPermissions?: unknown;
  teamRevokedPermissions?: unknown;
}

/** The member's role fields as stored, read before a change. */
export interface CurrentMemberRole {
  teamRoleId?: Types.ObjectId | null;
  teamExtraPermissions?: string[];
  teamRevokedPermissions?: string[];
}

/** What a save changes about a member's access (the duties it needs). */
export interface MemberAccessChanges {
  /** A different role than they have (or their first). */
  role: boolean;
  /** Different permissions on top of the role, or taken from it. */
  permissions: boolean;
}

type TeamRoleRow = NonNullable<Awaited<ReturnType<typeof findTeamRole>>>;

function hasRoleFields(input: MemberRoleInput): boolean {
  return (
    input.teamRoleId !== undefined ||
    input.teamExtraPermissions !== undefined ||
    input.teamRevokedPermissions !== undefined
  );
}

const sameList = (a: readonly string[] = [], b: readonly string[] = []) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
};

/**
 * Whether the member's own changes from their role differ from what is
 * stored; for a new member, whether they have any.
 */
function permissionsChanged(
  fields: { teamExtraPermissions: readonly string[]; teamRevokedPermissions: readonly string[] },
  current: CurrentMemberRole | null | undefined,
): boolean {
  if (!current) return fields.teamExtraPermissions.length > 0 || fields.teamRevokedPermissions.length > 0;
  return (
    !sameList(fields.teamExtraPermissions, current.teamExtraPermissions) ||
    !sameList(fields.teamRevokedPermissions, current.teamRevokedPermissions)
  );
}

function refuseGrant(actor: TeamAccess, grant: TeamGrant, held?: TeamGrant): void {
  const refusal = grantRefusal(actor, grant, held);
  if (refusal) throw new AuthorizationError(refusal);
}

/** The role a member from before roles is on: the Administrator for an administrator, Staff for staff. */
async function currentRoleId(current: CurrentMemberRole | null | undefined, fallbackKey: string): Promise<string | null> {
  if (!current) return null;
  if (current.teamRoleId) return String(current.teamRoleId);
  const fallback = await findTeamRole(fallbackKey);
  return fallback ? String(fallback._id) : null;
}

/**
 * Refuses a role the actor may not give. The Owner gives any; the
 * Administrator role (full access) is the Owner's alone; a full
 * administrator gives any other; anyone else only the roles their own role
 * lists in `assignableRoleIds`, which the Owner sets.
 */
export async function assertMayAssignRole(actor: TeamAccess, role: TeamRoleRow): Promise<void> {
  if (actor.isOwner) return;
  if (role.allPermissions) {
    throw new AuthorizationError(`Only the store owner can give the ${role.name} role.`);
  }
  if (actor.fullAccess) return;
  const own = actor.roleId && Types.ObjectId.isValid(actor.roleId)
    ? await TeamRole.findById(actor.roleId).select("assignableRoleIds").lean<{ assignableRoleIds?: Types.ObjectId[] }>()
    : null;
  const assignable = new Set((own?.assignableRoleIds ?? []).map(String));
  if (!assignable.has(String(role._id))) {
    throw new AuthorizationError(`Your role cannot give the ${role.name} role.`);
  }
}

/**
 * The admin-profile fields for an administrator: the named role (an
 * admin-tier one), else the one they have, else the Administrator; with
 * their own extras and revokes. Null when nothing about the role was sent and
 * the member already has their fields.
 *
 * `held` is what the member holds now (nothing for a new administrator or
 * one being promoted): what they keep is not checked again, only what the
 * save would give them on top.
 */
export async function adminMemberRoleFields(
  input: MemberRoleInput,
  actor: TeamAccess,
  current?: CurrentMemberRole | null,
  held?: TeamGrant,
) {
  if (!hasRoleFields(input) && current) return null;
  const roleRef =
    (typeof input.teamRoleId === "string" && input.teamRoleId) ||
    (current?.teamRoleId ? String(current.teamRoleId) : BUILT_IN_TEAM_ROLE_KEYS.ADMINISTRATOR);
  const role = await findTeamRole(roleRef);
  if (!role) throw new ValidationError({ teamRoleId: ["That role does not exist"] });
  if (role.tier !== "admin") {
    throw new ValidationError({ teamRoleId: ["That role is for the staff area; choose an admin dashboard role"] });
  }
  const extra = input.teamExtraPermissions !== undefined
    ? sanitizeTeamPermissions(input.teamExtraPermissions, "admin")
    : (current?.teamExtraPermissions ?? []);
  const revoked = input.teamRevokedPermissions !== undefined
    ? sanitizeTeamPermissions(input.teamRevokedPermissions, "admin", { revoke: true })
    : (current?.teamRevokedPermissions ?? []);
  const fields = adminProfileTeamFields(role, extra, revoked);

  const changes: MemberAccessChanges = {
    role: (await currentRoleId(current, BUILT_IN_TEAM_ROLE_KEYS.ADMINISTRATOR)) !== String(role._id),
    permissions: permissionsChanged(fields, current),
  };
  if (changes.role) await assertMayAssignRole(actor, role);
  refuseGrant(actor, { fullAccess: fields.teamFullAccess, permissions: fields.teamPermissions }, held);
  return { fields, role, changes };
}

/**
 * The staff-profile fields for a staff member of the store's own team. Every
 * one has a staff-tier role: the one named, else the one they have, else the
 * built-in Staff. Their own extras and revokes come with it; a whole
 * permission list (an API client, or a member from before roles) is kept as
 * changes from the role, so they hold exactly that list. Null when nothing
 * about their access was sent and they already have their fields.
 *
 * `held` is the member's permissions now (nothing for a new member).
 */
export async function staffMemberRoleFields(
  input: MemberRoleInput & { permissions?: unknown },
  actor: TeamAccess,
  current?: CurrentMemberRole | null,
  held?: TeamGrant,
): Promise<{ set: Record<string, unknown>; permissions: StaffPermission[]; role: TeamRoleRow; changes: MemberAccessChanges } | null> {
  if (!hasRoleFields(input) && input.permissions === undefined && current) return null;
  const roleRef =
    (typeof input.teamRoleId === "string" && input.teamRoleId) ||
    (input.teamRoleId === undefined && current?.teamRoleId ? String(current.teamRoleId) : BUILT_IN_TEAM_ROLE_KEYS.STAFF);
  const role = await findTeamRole(roleRef);
  if (!role) throw new ValidationError({ teamRoleId: ["That role does not exist"] });
  if (role.tier !== "staff") {
    throw new ValidationError({ teamRoleId: ["That role is for the admin dashboard; choose a staff role"] });
  }

  let extra: string[];
  let revoked: string[];
  // A whole list: sent alone, or with `teamRoleId: null` (the form's "their own
  // list" from before every staff member had a role).
  const wholeList =
    input.permissions !== undefined &&
    (input.teamRoleId === null || (input.teamExtraPermissions === undefined && input.teamRevokedPermissions === undefined));
  if (wholeList) {
    const wanted = new Set<string>(sanitizeTeamPermissions(input.permissions, "staff"));
    const base = new Set<string>(sanitizeTeamPermissions(role.permissions, "staff"));
    extra = Array.from(wanted).filter((permission) => !base.has(permission));
    revoked = Array.from(base).filter((permission) => !wanted.has(permission));
  } else {
    const sameRole = Boolean(current?.teamRoleId && String(current.teamRoleId) === String(role._id));
    extra = input.teamExtraPermissions !== undefined
      ? sanitizeTeamPermissions(input.teamExtraPermissions, "staff")
      : sameRole ? (current?.teamExtraPermissions ?? []) : [];
    revoked = input.teamRevokedPermissions !== undefined
      ? sanitizeTeamPermissions(input.teamRevokedPermissions, "staff", { revoke: true })
      : sameRole ? (current?.teamRevokedPermissions ?? []) : [];
  }
  const fields = staffProfileTeamFields(role, extra, revoked);

  const changes: MemberAccessChanges = {
    role: (await currentRoleId(current, BUILT_IN_TEAM_ROLE_KEYS.STAFF)) !== String(role._id),
    permissions: permissionsChanged(fields, current),
  };
  if (changes.role) await assertMayAssignRole(actor, role);
  refuseGrant(actor, { fullAccess: false, permissions: fields.permissions }, held);
  return { set: fields, permissions: fields.permissions, role, changes };
}

/* ------------------------------------------------------------------ */
/* Who may change whom                                                 */
/* ------------------------------------------------------------------ */

/** The team duties a save may need (config ADMIN_AREA_PERMISSIONS). */
export const TEAM_DUTIES = {
  /** Add a member. */
  create: ADMIN_AREA_PERMISSIONS.CREATE_TEAM_MEMBERS,
  /** Move a member onto another role, or between the dashboards. */
  assignRole: ADMIN_AREA_PERMISSIONS.ASSIGN_TEAM_ROLES,
  /** Change what a member holds on top of their role. */
  editPermissions: ADMIN_AREA_PERMISSIONS.EDIT_MEMBER_PERMISSIONS,
  /** Change a member's details or status, invite or remove them. */
  manage: ADMIN_AREA_PERMISSIONS.MANAGE_TEAM,
} as const;

const DUTY_WORDS: Record<keyof typeof TEAM_DUTIES, string> = {
  create: "add team members",
  assignRole: "change a team member's role",
  editPermissions: "change a team member's own permissions",
  manage: "change team members",
};

/** Refuses unless the actor holds each duty named: adding, giving roles and editing permissions are separate grants. */
export function assertTeamDuties(actor: TeamAccess, duties: readonly (keyof typeof TEAM_DUTIES)[]): void {
  for (const duty of duties) {
    if (!teamHasAny(actor, [TEAM_DUTIES[duty]])) {
      throw new AuthorizationError(`Your team role does not let you ${DUTY_WORDS[duty]}.`);
    }
  }
}

/** Nobody changes their own role or permissions: that is always someone above them. */
export function assertNotOwnAccess(actorUserId: string, targetUserId: string): void {
  if (actorUserId === targetUserId) {
    throw new AuthorizationError("You cannot change your own role or permissions.");
  }
}

/** What a team account holds now: an administrator's team access, a staff member's permissions. */
export async function teamMemberHolds(target: { userId: string; role?: string | null }): Promise<TeamGrant & { isOwner: boolean }> {
  if (target.role === USER_ROLES.ADMIN) {
    const access = await resolveTeamAccess(target.userId);
    return { isOwner: access.isOwner, fullAccess: access.fullAccess, permissions: Array.from(access.permissions) };
  }
  if (isStaffRole(target.role) && Types.ObjectId.isValid(target.userId)) {
    const profile = await StaffProfile.findOne({ userId: target.userId })
      .select("permissions")
      .lean<{ permissions?: string[] }>();
    return { isOwner: false, fullAccess: false, permissions: sanitizeTeamPermissions(profile?.permissions ?? [], "staff") };
  }
  return { isOwner: false, fullAccess: false, permissions: [] };
}

/**
 * Refuses a change to a member at or above the actor's own level, and answers
 * what the member holds now. The Owner changes anyone; only the Owner changes
 * the Owner's account or a full administrator; anyone else only members who
 * hold less than they do. Your own account passes here (its details are
 * yours); its role and permissions never do (`assertNotOwnAccess`). The
 * Owner's other protections live in lib/access/team-roles.ts.
 */
export async function assertMayManageMember(
  actor: TeamAccess,
  target: { userId: string; role?: string | null },
): Promise<TeamGrant> {
  const held = await teamMemberHolds(target);
  if (actor.isOwner || target.userId === actor.userId) return held;
  if (held.isOwner) throw new AuthorizationError("Only the store owner can change the owner's account.");
  if (held.fullAccess) throw new AuthorizationError("Only the store owner can change a full administrator.");
  if (!isBelowTeamAccess(actor, held)) {
    throw new AuthorizationError("You cannot change a team member whose access is equal to or more than yours.");
  }
  return held;
}

/* ------------------------------------------------------------------ */
/* What the person saving may give (for the screens)                   */
/* ------------------------------------------------------------------ */

/**
 * What the signed-in member may give, so the Team screens offer only that:
 * the roles they may give, the permissions they may give, and the separate
 * grants they hold. The routes check the same rules again on every save.
 */
export interface TeamGrantScope {
  isOwner: boolean;
  /** Full access, the Administrator role: the Owner's alone to give. */
  canGiveFullAccess: boolean;
  /** The roles they may give; null for any role but the Administrator. */
  assignableRoleIds: string[] | null;
  /** The permissions they may give (to a new member, or on top of a role). */
  grantable: string[];
  duties: Record<keyof typeof TEAM_DUTIES, boolean>;
}

export async function resolveTeamGrantScope(actor: TeamAccess): Promise<TeamGrantScope> {
  const duties = Object.fromEntries(
    (Object.keys(TEAM_DUTIES) as (keyof typeof TEAM_DUTIES)[]).map((duty) => [duty, teamHasAny(actor, [TEAM_DUTIES[duty]])]),
  ) as TeamGrantScope["duties"];
  if (actor.isOwner) {
    return { isOwner: true, canGiveFullAccess: true, assignableRoleIds: null, grantable: [...ALL_TEAM_PERMISSIONS], duties };
  }
  const held = actor.fullAccess ? ALL_TEAM_PERMISSIONS : Array.from(actor.permissions);
  const grantable = held.filter((permission) => !isOwnerOnlyPermission(permission));
  if (actor.fullAccess) {
    return { isOwner: false, canGiveFullAccess: false, assignableRoleIds: null, grantable, duties };
  }
  const own = actor.roleId && Types.ObjectId.isValid(actor.roleId)
    ? await TeamRole.findById(actor.roleId).select("assignableRoleIds").lean<{ assignableRoleIds?: Types.ObjectId[] }>()
    : null;
  return {
    isOwner: false,
    canGiveFullAccess: false,
    assignableRoleIds: (own?.assignableRoleIds ?? []).map(String),
    grantable,
    duties,
  };
}

/** What the signed-in member may do to one member, for the member's page. */
export interface MemberViewerAccess {
  /** Change them at all (their details, status, invitation, removal). */
  canManage: boolean;
  /** Move them onto another role. */
  canChangeRole: boolean;
  /** Change what they hold on top of their role. */
  canChangePermissions: boolean;
}

export async function memberViewerAccess(
  actor: TeamAccess,
  target: { userId: string; role?: string | null },
): Promise<MemberViewerAccess> {
  let below = true;
  try {
    await assertMayManageMember(actor, target);
  } catch {
    below = false;
  }
  const self = actor.userId === target.userId;
  return {
    canManage: below && teamHasAny(actor, [TEAM_DUTIES.manage]),
    canChangeRole: below && !self && teamHasAny(actor, [TEAM_DUTIES.assignRole]),
    canChangePermissions: below && !self && teamHasAny(actor, [TEAM_DUTIES.editPermissions]),
  };
}

/** A member's role and what it gives them, as the Activity Log records it. */
export interface MemberAccessRecord {
  /** The role's name: "Owner" for the Owner; Administrator or Staff for a member from before roles. */
  teamRole: string;
  fullAccess: boolean;
  /** Held permissions; empty with full access. */
  permissions: string[];
}

/**
 * What a team account holds, with its role's name, read as stored: the audit
 * compares this before and after a save, so a role given or changed is
 * always a row (lib/access/audit-staff.ts).
 */
export async function memberAccessRecord(userId: string, accountRole?: string | null): Promise<MemberAccessRecord> {
  const none: MemberAccessRecord = { teamRole: "", fullAccess: false, permissions: [] };
  if (!Types.ObjectId.isValid(userId)) return none;
  const roleNameOf = async (roleId: unknown, fallback: string) => {
    if (!roleId || !Types.ObjectId.isValid(String(roleId))) return fallback;
    const role = await TeamRole.findById(roleId).select("name").lean<{ name?: string }>();
    return role?.name ?? fallback;
  };
  if (accountRole === USER_ROLES.ADMIN) {
    const profile = await AdminProfile.findOne({ userId })
      .select("isSuperAdmin teamRoleId teamFullAccess teamPermissions")
      .lean<{ isSuperAdmin?: boolean; teamRoleId?: Types.ObjectId | null; teamFullAccess?: boolean; teamPermissions?: string[] }>();
    const access = teamAccessFromProfile(userId, profile);
    return {
      teamRole: access.isOwner ? "Owner" : await roleNameOf(profile?.teamRoleId, "Administrator"),
      fullAccess: access.fullAccess,
      permissions: access.fullAccess ? [] : Array.from(access.permissions).sort(),
    };
  }
  if (isStaffRole(accountRole)) {
    const profile = await StaffProfile.findOne({ userId })
      .select("teamRoleId permissions")
      .lean<{ teamRoleId?: Types.ObjectId | null; permissions?: string[] }>();
    if (!profile) return none;
    return {
      // Staff from before roles are the Staff role's members (team-role-service).
      teamRole: await roleNameOf(profile.teamRoleId, "Staff"),
      fullAccess: false,
      permissions: sanitizeTeamPermissions(profile.permissions ?? [], "staff").sort(),
    };
  }
  return none;
}

/** The admin profile's role fields, as the Team form edits them. */
export async function readAdminMemberRole(userId: string) {
  if (!Types.ObjectId.isValid(userId)) return null;
  return AdminProfile.findOne({ userId })
    .select("isSuperAdmin teamRoleId teamExtraPermissions teamRevokedPermissions teamFullAccess teamPermissions")
    .lean<{
      isSuperAdmin?: boolean;
      teamRoleId?: Types.ObjectId | null;
      teamExtraPermissions?: string[];
      teamRevokedPermissions?: string[];
      teamFullAccess?: boolean;
      teamPermissions?: string[];
    }>();
}
