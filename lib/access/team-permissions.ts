import { Types } from "mongoose";
import { AdminProfile, StaffProfile } from "@/models";
import type { ITeamRole } from "@/models/team-role.model";
import {
  ALL_TEAM_PERMISSIONS,
  isOwnerOnlyPermission,
  isStaffTierPermission,
  isTeamPermission,
  permissionsForTier,
  type TeamPermission,
  type TeamRoleTier,
} from "@/config/team-permissions.config";
import {
  RETIRED_STAFF_PERMISSION_GRANTS,
  resolveRetiredStaffPermissions,
  type StaffPermission,
} from "@/config/permissions.config";

/**
 * Team roles and permissions (config/team-permissions.config.ts): what a
 * member holds, written onto their profile; what a member of the admin
 * dashboard may do, read back; and who may hand out what.
 */

/** What a member of the admin dashboard may do. */
export interface TeamAccess {
  userId: string;
  /** The Owner (`AdminProfile.isSuperAdmin`): everything, always, and untouchable. */
  isOwner: boolean;
  /** Everything, including permissions a later release adds. */
  fullAccess: boolean;
  /** Held permissions; every team permission when `fullAccess`. */
  permissions: ReadonlySet<string>;
  /**
   * The member's team role (`AdminProfile.teamRoleId`), whose
   * `assignableRoleIds` say which roles they may give; absent for the Owner
   * and an administrator from before roles.
   */
  roleId?: string;
}

const ALL_PERMISSIONS_SET: ReadonlySet<string> = new Set(ALL_TEAM_PERMISSIONS);

/** A member who holds everything: the Owner, or an administrator without restrictions. */
export function fullTeamAccess(
  userId: string,
  options: { isOwner?: boolean; roleId?: string } = {},
): TeamAccess {
  return {
    userId,
    isOwner: Boolean(options.isOwner),
    fullAccess: true,
    permissions: ALL_PERMISSIONS_SET,
    ...(options.roleId ? { roleId: options.roleId } : {}),
  };
}

/** A member who holds nothing: what an unreadable account is taken for. */
export function noTeamAccess(userId: string): TeamAccess {
  return { userId, isOwner: false, fullAccess: false, permissions: new Set() };
}

/** Whether the member holds at least one of `required` (an empty list asks for nothing). */
export function teamHasAny(access: TeamAccess, required: readonly string[]): boolean {
  if (access.fullAccess || required.length === 0) return true;
  return required.some((permission) => access.permissions.has(permission));
}

export function teamHasAll(access: TeamAccess, required: readonly string[]): boolean {
  if (access.fullAccess) return true;
  return required.every((permission) => access.permissions.has(permission));
}

/**
 * The string list a permission field may hold for a tier: known strings only,
 * once each. A retired string (`RETIRED_STAFF_PERMISSION_GRANTS`) reads as the
 * one it stands for when granted; a revoke of one reached nothing and is
 * dropped, since promoting it would take away access the member holds.
 */
export function sanitizeTeamPermissions(
  input: unknown,
  tier: TeamRoleTier,
  options: { revoke?: boolean } = {},
): TeamPermission[] {
  if (!Array.isArray(input)) return [];
  const allowed = tier === "admin" ? isTeamPermission : isStaffTierPermission;
  const strings = options.revoke
    ? input.filter((permission) => !(typeof permission === "string" && permission in RETIRED_STAFF_PERMISSION_GRANTS))
    : resolveRetiredStaffPermissions(input);
  return Array.from(new Set(strings.filter(allowed))) as TeamPermission[];
}

export interface RoleShape {
  tier: TeamRoleTier;
  allPermissions?: boolean;
  permissions?: readonly string[];
}

/**
 * A member's effective permissions: the role's, plus extras, minus revokes,
 * kept to what the tier can hold. `fullAccess` only for an all-permissions
 * role with nothing revoked — a revoke turns it into an explicit list.
 */
export function computeMemberPermissions(
  role: RoleShape,
  extra: readonly string[] = [],
  revoked: readonly string[] = [],
): { fullAccess: boolean; permissions: TeamPermission[] } {
  const universe = permissionsForTier(role.tier);
  const allowed = new Set<string>(universe);
  const revokedSet = new Set(revoked.filter((permission) => allowed.has(permission)));
  if (role.allPermissions && role.tier === "admin" && revokedSet.size === 0) {
    return { fullAccess: true, permissions: [...universe] };
  }
  const base = role.allPermissions ? universe : (role.permissions ?? []);
  const held = new Set<string>();
  for (const permission of resolveRetiredStaffPermissions([...base, ...extra])) {
    if (allowed.has(permission) && !revokedSet.has(permission)) held.add(permission);
  }
  return {
    fullAccess: false,
    permissions: universe.filter((permission) => held.has(permission)),
  };
}

/* ------------------------------------------------------------------ */
/* Reading a member's access                                           */
/* ------------------------------------------------------------------ */

interface AdminProfileTeamFields {
  isSuperAdmin?: boolean;
  teamRoleId?: Types.ObjectId | null;
  teamFullAccess?: boolean;
  teamPermissions?: string[];
}

/** What an admin profile row says the member may do (no role read: the fields are written). */
export function teamAccessFromProfile(userId: string, profile: AdminProfileTeamFields | null): TeamAccess {
  if (profile?.isSuperAdmin) return fullTeamAccess(userId, { isOwner: true });
  // No profile, or one from before roles: an administrator holds everything,
  // as every administrator did before roles. `db:migrate team-access-hierarchy`
  // writes each of them onto the Administrator role, so this stays only for a
  // store that has not run it yet.
  if (!profile?.teamRoleId) return fullTeamAccess(userId);
  const roleId = String(profile.teamRoleId);
  // Full access only when the row says so; a row that does not say reads as
  // its list, never as everything.
  if (profile.teamFullAccess === true) return fullTeamAccess(userId, { roleId });
  return {
    userId,
    isOwner: false,
    fullAccess: false,
    permissions: new Set(sanitizeTeamPermissions(profile.teamPermissions, "admin")),
    roleId,
  };
}

/**
 * The admin-dashboard access of a signed-in administrator account: one
 * indexed read of their profile, which carries the permissions their role
 * wrote there. Every admin API request makes it, so it reads nothing else.
 */
export async function resolveTeamAccess(userId: string): Promise<TeamAccess> {
  if (!Types.ObjectId.isValid(userId)) return noTeamAccess(userId);
  const profile = await AdminProfile.findOne({ userId })
    .select("isSuperAdmin teamRoleId teamFullAccess teamPermissions")
    .lean<AdminProfileTeamFields>();
  return teamAccessFromProfile(userId, profile);
}

/* ------------------------------------------------------------------ */
/* Who may hand out what                                               */
/* ------------------------------------------------------------------ */

/** A set of permissions someone holds or would hold. */
export interface TeamGrant {
  fullAccess: boolean;
  permissions: readonly string[];
}

const NOTHING_HELD: TeamGrant = { fullAccess: false, permissions: [] };

/**
 * What `grant` gives that the member does not already hold, and that the
 * actor may not give: `"*"` for full access, then each permission. Empty when
 * the actor may give it all.
 *
 * - The Owner gives anything.
 * - Full access and the Owner-only permissions (config OWNER_ONLY_PERMISSIONS)
 *   are the Owner's alone to give. Since adding a member or changing one
 *   needs one of those, whatever anyone else gives is less than they hold.
 * - A full administrator gives any other permission; anyone else only those
 *   they hold.
 *
 * `held` is what the member holds now: keeping it is not giving it, so a
 * member the Owner gave a team permission keeps it when someone else edits
 * their details. A new member holds nothing.
 */
export function permissionsBeyondActor(
  actor: TeamAccess,
  grant: TeamGrant,
  held: TeamGrant = NOTHING_HELD,
): string[] {
  if (actor.isOwner) return [];
  if (grant.fullAccess) return held.fullAccess ? [] : ["*"];
  if (held.fullAccess) return [];
  const already = new Set(held.permissions);
  return grant.permissions.filter(
    (permission) =>
      !already.has(permission) &&
      (isOwnerOnlyPermission(permission) || !(actor.fullAccess || actor.permissions.has(permission))),
  );
}

/** Whether `actor` may give `grant` to a member who holds `held` (see `permissionsBeyondActor`). */
export function canGrantTeamPermissions(actor: TeamAccess, grant: TeamGrant, held?: TeamGrant): boolean {
  return permissionsBeyondActor(actor, grant, held).length === 0;
}

/** The refusal for a grant `actor` may not give, in words; null when they may. */
export function grantRefusal(actor: TeamAccess, grant: TeamGrant, held?: TeamGrant): string | null {
  const beyond = permissionsBeyondActor(actor, grant, held);
  if (beyond.length === 0) return null;
  if (beyond.includes("*")) return "Only the store owner can give full access.";
  const ownerOnly = beyond.filter(isOwnerOnlyPermission);
  if (ownerOnly.length > 0) return `Only the store owner can give: ${ownerOnly.join(", ")}.`;
  return `You cannot give permissions you do not have: ${beyond.join(", ")}.`;
}

/**
 * Whether `held` is below `actor`: every permission the actor holds, and not
 * all of them. A member at the actor's level, or above, is not theirs to
 * change.
 */
export function isBelowTeamAccess(actor: TeamAccess, held: TeamGrant): boolean {
  if (held.fullAccess) return false;
  if (actor.fullAccess) return true;
  const own = new Set(held.permissions);
  if (![...own].every((permission) => actor.permissions.has(permission))) return false;
  return own.size < actor.permissions.size;
}

/* ------------------------------------------------------------------ */
/* Writing a member's permissions                                      */
/* ------------------------------------------------------------------ */

export interface MemberRoleAssignment {
  roleId: Types.ObjectId;
  extra: TeamPermission[];
  revoked: TeamPermission[];
}

/** The fields an admin profile carries for a role assignment. */
export function adminProfileTeamFields(
  role: RoleShape & { _id: Types.ObjectId },
  extra: readonly string[],
  revoked: readonly string[],
) {
  const computed = computeMemberPermissions(role, extra, revoked);
  return {
    teamRoleId: role._id,
    teamExtraPermissions: sanitizeTeamPermissions(extra, "admin"),
    teamRevokedPermissions: sanitizeTeamPermissions(revoked, "admin", { revoke: true }),
    teamFullAccess: computed.fullAccess,
    teamPermissions: computed.fullAccess ? [] : computed.permissions,
  };
}

/** The fields a staff profile carries for a staff-tier role assignment. */
export function staffProfileTeamFields(
  role: RoleShape & { _id: Types.ObjectId },
  extra: readonly string[],
  revoked: readonly string[],
) {
  const computed = computeMemberPermissions({ ...role, tier: "staff" }, extra, revoked);
  return {
    teamRoleId: role._id,
    teamExtraPermissions: sanitizeTeamPermissions(extra, "staff"),
    teamRevokedPermissions: sanitizeTeamPermissions(revoked, "staff", { revoke: true }),
    permissions: computed.permissions as StaffPermission[],
  };
}

/**
 * After a role changes, every member on it holds the new permissions: their
 * profiles are re-written from the role and each one's own extras and
 * revokes. Returns how many members were updated.
 */
export async function reapplyTeamRole(role: ITeamRole & { _id: Types.ObjectId }): Promise<number> {
  let updated = 0;
  if (role.tier === "admin") {
    const members = await AdminProfile.find({ teamRoleId: role._id, isSuperAdmin: { $ne: true } })
      .select("_id teamExtraPermissions teamRevokedPermissions")
      .lean<{ _id: Types.ObjectId; teamExtraPermissions?: string[]; teamRevokedPermissions?: string[] }[]>();
    for (const member of members) {
      await AdminProfile.updateOne(
        { _id: member._id },
        { $set: adminProfileTeamFields(role, member.teamExtraPermissions ?? [], member.teamRevokedPermissions ?? []) },
      );
      updated += 1;
    }
  } else {
    const members = await StaffProfile.find({ teamRoleId: role._id })
      .select("_id teamExtraPermissions teamRevokedPermissions")
      .lean<{ _id: Types.ObjectId; teamExtraPermissions?: string[]; teamRevokedPermissions?: string[] }[]>();
    for (const member of members) {
      await StaffProfile.updateOne(
        { _id: member._id },
        { $set: staffProfileTeamFields(role, member.teamExtraPermissions ?? [], member.teamRevokedPermissions ?? []) },
      );
      updated += 1;
    }
  }
  return updated;
}

/** How many members each role has, by role id. */
export async function countTeamRoleMembers(): Promise<Map<string, number>> {
  const [admins, staff] = await Promise.all([
    AdminProfile.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { teamRoleId: { $exists: true, $ne: null }, isSuperAdmin: { $ne: true } } },
      { $group: { _id: "$teamRoleId", count: { $sum: 1 } } },
    ]),
    StaffProfile.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { teamRoleId: { $exists: true, $ne: null } } },
      { $group: { _id: "$teamRoleId", count: { $sum: 1 } } },
    ]),
  ]);
  const counts = new Map<string, number>();
  for (const row of [...admins, ...staff]) {
    counts.set(String(row._id), (counts.get(String(row._id)) ?? 0) + row.count);
  }
  return counts;
}
