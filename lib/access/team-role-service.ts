import { Types } from "mongoose";
import * as z from "zod";
import { AdminProfile, StaffProfile } from "@/models";
import { TeamRole } from "@/models/team-role.model";
import type { ITeamRole } from "@/models/team-role.model";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { audit, type AuditContext } from "@/lib/audit";
import { slugify } from "@/lib/strings";
import {
  BUILT_IN_TEAM_ROLE_KEYS,
  TEAM_ROLE_TIERS,
} from "@/config/team-permissions.config";
import {
  countTeamRoleMembers,
  grantRefusal,
  isBelowTeamAccess,
  reapplyTeamRole,
  sanitizeTeamPermissions,
  type TeamAccess,
} from "@/lib/access/team-permissions";
import { ensureBuiltInTeamRoles } from "@/lib/access/team-role-store";
import { PLATFORM_OWNED_STAFF_FILTER } from "@/lib/access/staff-ownership";

/**
 * The Roles screen's reads and writes (GET, POST /api/admin/team-roles;
 * GET, PUT, DELETE /api/admin/team-roles/[id]). A role's permissions are
 * never more than the person saving may give (only the Owner gives the
 * Owner-only permissions), the Administrator always holds everything, a
 * role's tier (which dashboard its members use) never changes once it has
 * members to move, nobody but the Owner changes the role they hold, and only
 * the Owner decides which roles a role's members may give
 * (`assignableRoleIds`).
 */

export interface TeamRoleView {
  _id: string;
  key: string;
  name: string;
  description: string;
  tier: (typeof TEAM_ROLE_TIERS)[number];
  allPermissions: boolean;
  permissions: string[];
  /** The roles this role's members may give someone (set by the Owner). */
  assignableRoleIds: string[];
  builtIn: boolean;
  memberCount: number;
  createdAt?: string;
  updatedAt?: string;
}

type RoleRow = ITeamRole & { _id: Types.ObjectId };

function view(role: RoleRow, memberCount: number): TeamRoleView {
  return {
    _id: String(role._id),
    key: role.key,
    name: role.name,
    description: role.description ?? "",
    tier: role.tier,
    allPermissions: Boolean(role.allPermissions),
    permissions: role.allPermissions ? [] : sanitizeTeamPermissions(role.permissions, role.tier),
    assignableRoleIds: (role.assignableRoleIds ?? []).map(String),
    builtIn: Boolean(role.builtIn),
    memberCount,
    createdAt: role.createdAt ? new Date(role.createdAt).toISOString() : undefined,
    updatedAt: role.updatedAt ? new Date(role.updatedAt).toISOString() : undefined,
  };
}

/** Administrators from before roles count as the Administrator's members. */
async function legacyAdministratorCount(): Promise<number> {
  return AdminProfile.countDocuments({
    isSuperAdmin: { $ne: true },
    $or: [{ teamRoleId: { $exists: false } }, { teamRoleId: null }],
  });
}

/** The store's own staff from before 3.1 (no role yet) count as the Staff role's members. */
async function legacyStaffCount(): Promise<number> {
  return StaffProfile.countDocuments({
    $and: [PLATFORM_OWNED_STAFF_FILTER, { $or: [{ teamRoleId: { $exists: false } }, { teamRoleId: null }] }],
  });
}

async function memberCountOf(role: RoleRow, counts?: Map<string, number>): Promise<number> {
  const map = counts ?? (await countTeamRoleMembers());
  const own = map.get(String(role._id)) ?? 0;
  if (role.key === BUILT_IN_TEAM_ROLE_KEYS.ADMINISTRATOR) return own + (await legacyAdministratorCount());
  if (role.key === BUILT_IN_TEAM_ROLE_KEYS.STAFF) return own + (await legacyStaffCount());
  return own;
}

export async function listTeamRoles(): Promise<TeamRoleView[]> {
  await ensureBuiltInTeamRoles();
  const [roles, counts] = await Promise.all([
    TeamRole.find({}).sort({ builtIn: -1, tier: 1, name: 1 }).lean<RoleRow[]>(),
    countTeamRoleMembers(),
  ]);
  return Promise.all(roles.map(async (role) => view(role, await memberCountOf(role, counts))));
}

async function loadRole(id: string): Promise<RoleRow> {
  await ensureBuiltInTeamRoles();
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError("Role");
  const role = await TeamRole.findById(id).lean<RoleRow>();
  if (!role) throw new NotFoundError("Role");
  return role;
}

export async function getTeamRole(id: string): Promise<TeamRoleView> {
  const role = await loadRole(id);
  return view(role, await memberCountOf(role));
}

export const CreateTeamRoleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  description: z.string().trim().max(300).optional(),
  tier: z.enum(TEAM_ROLE_TIERS).default("admin"),
  permissions: z.array(z.string().max(64)).max(300).default([]),
  assignableRoleIds: z.array(z.string().max(64)).max(100).optional(),
});

export const UpdateTeamRoleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60).optional(),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string().max(64)).max(300).optional(),
  assignableRoleIds: z.array(z.string().max(64)).max(100).optional(),
});

/** Refuses a role the actor could not give (lib/access/team-permissions.ts `grantRefusal`). */
function assertWithinActor(actor: TeamAccess, grant: { fullAccess: boolean; permissions: readonly string[] }) {
  const refusal = grantRefusal(actor, grant);
  if (refusal) throw new AuthorizationError(refusal);
}

/**
 * A change to a role reaches everyone on it, so it is made only by someone
 * above every one of them: a member the Owner gave more on top of the role is
 * not changed through it by anyone else. The Owner changes any role.
 */
async function assertRoleMembersBelow(actor: TeamAccess, role: RoleRow) {
  if (actor.isOwner) return;
  const [admins, staff] = await Promise.all([
    role.tier === "admin"
      ? AdminProfile.find({ teamRoleId: role._id, isSuperAdmin: { $ne: true } })
          .select("teamFullAccess teamPermissions")
          .lean<{ teamFullAccess?: boolean; teamPermissions?: string[] }[]>()
      : Promise.resolve([]),
    role.tier === "staff"
      ? StaffProfile.find({ teamRoleId: role._id }).select("permissions").lean<{ permissions?: string[] }[]>()
      : Promise.resolve([]),
  ]);
  const held = [
    ...admins.map((member) => ({
      fullAccess: member.teamFullAccess === true,
      permissions: sanitizeTeamPermissions(member.teamPermissions, "admin"),
    })),
    ...staff.map((member) => ({ fullAccess: false, permissions: sanitizeTeamPermissions(member.permissions, "staff") })),
  ];
  if (held.some((member) => !isBelowTeamAccess(actor, member))) {
    throw new AuthorizationError(
      "Someone on this role has as much access as you, or more. Only someone above them can change it.",
    );
  }
}

/** Nobody but the Owner changes the role they hold: that would be raising themselves. */
function assertNotOwnRole(actor: TeamAccess, role: RoleRow) {
  if (!actor.isOwner && actor.roleId && actor.roleId === String(role._id)) {
    throw new AuthorizationError("You cannot change the role you hold.");
  }
}

/**
 * The roles a role's members may give, as stored: existing roles, each once,
 * never the role itself (that would make peers) and never one with full
 * access (only the Owner gives it). Only the Owner sets the list.
 */
async function assignableRoleIdsFor(
  actor: TeamAccess,
  input: string[] | undefined,
  role: { _id?: Types.ObjectId; assignableRoleIds?: Types.ObjectId[] },
): Promise<Types.ObjectId[] | undefined> {
  if (input === undefined) return undefined;
  const ids = Array.from(new Set(input.filter((id) => Types.ObjectId.isValid(id))));
  const unchanged =
    ids.length === (role.assignableRoleIds ?? []).length &&
    (role.assignableRoleIds ?? []).every((id) => ids.includes(String(id)));
  if (unchanged) return undefined;
  if (!actor.isOwner) {
    throw new AuthorizationError("Only the store owner decides which roles a role can give.");
  }
  if (role._id && ids.includes(String(role._id))) {
    throw new ValidationError({ assignableRoleIds: ["A role cannot give itself"] });
  }
  const found = await TeamRole.find({ _id: { $in: ids } }).select("_id allPermissions").lean<{ _id: Types.ObjectId; allPermissions?: boolean }[]>();
  if (found.length !== ids.length) {
    throw new ValidationError({ assignableRoleIds: ["One of those roles does not exist"] });
  }
  if (found.some((row) => row.allPermissions)) {
    throw new ValidationError({ assignableRoleIds: ["Full access is given by the store owner only"] });
  }
  return ids.map((id) => new Types.ObjectId(id));
}

async function uniqueKey(name: string): Promise<string> {
  const base = slugify(name).slice(0, 48) || "role";
  const reserved = new Set<string>(Object.values(BUILT_IN_TEAM_ROLE_KEYS));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const key = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (reserved.has(key)) continue;
    if (!(await TeamRole.exists({ key }))) return key;
  }
  return `${base}-${new Types.ObjectId().toHexString().slice(-6)}`;
}

export async function createTeamRole(
  input: z.infer<typeof CreateTeamRoleSchema>,
  actor: TeamAccess,
  auditContext: AuditContext,
): Promise<TeamRoleView> {
  await ensureBuiltInTeamRoles();
  const permissions = sanitizeTeamPermissions(input.permissions, input.tier);
  assertWithinActor(actor, { fullAccess: false, permissions });
  const assignableRoleIds = await assignableRoleIdsFor(actor, input.assignableRoleIds, {});
  if (await TeamRole.exists({ name: input.name })) {
    throw new ValidationError({ name: ["A role with this name already exists"] });
  }
  const created = await TeamRole.create({
    key: await uniqueKey(input.name),
    name: input.name,
    description: input.description,
    tier: input.tier,
    allPermissions: false,
    permissions,
    assignableRoleIds: assignableRoleIds ?? [],
    builtIn: false,
    createdBy: Types.ObjectId.isValid(actor.userId) ? new Types.ObjectId(actor.userId) : undefined,
  });
  await audit(auditContext, {
    action: "CREATE",
    resource: "teamRole",
    resourceId: String(created._id),
    resourceName: input.name,
    changes: {
      after: { name: input.name, tier: input.tier, permissions, assignableRoleIds: (assignableRoleIds ?? []).map(String) },
      summary: `Created the ${input.name} role`,
    },
  });
  return view(created.toObject() as RoleRow, 0);
}

export async function updateTeamRole(
  id: string,
  input: z.infer<typeof UpdateTeamRoleSchema>,
  actor: TeamAccess,
  auditContext: AuditContext,
): Promise<TeamRoleView> {
  const role = await loadRole(id);
  const isAdministrator = role.key === BUILT_IN_TEAM_ROLE_KEYS.ADMINISTRATOR;
  assertNotOwnRole(actor, role);
  // Editing a role at all reaches everyone on it: never a role beyond the actor.
  assertWithinActor(actor, {
    fullAccess: Boolean(role.allPermissions),
    permissions: sanitizeTeamPermissions(role.permissions, role.tier),
  });

  const set: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== role.name) {
    if (await TeamRole.exists({ name: input.name, _id: { $ne: role._id } })) {
      throw new ValidationError({ name: ["A role with this name already exists"] });
    }
    set.name = input.name;
  }
  if (input.description !== undefined) set.description = input.description;
  let permissionsChanged = false;
  if (input.permissions !== undefined) {
    if (isAdministrator) {
      throw new ValidationError({ permissions: ["The Administrator always holds every permission"] });
    }
    const permissions = sanitizeTeamPermissions(input.permissions, role.tier);
    assertWithinActor(actor, { fullAccess: false, permissions });
    set.permissions = permissions;
    permissionsChanged = true;
  }
  const assignableRoleIds = await assignableRoleIdsFor(actor, input.assignableRoleIds, role);
  if (assignableRoleIds) set.assignableRoleIds = assignableRoleIds;
  if (Object.keys(set).length === 0) return view(role, await memberCountOf(role));
  // What the members hold moves with the role's permissions.
  if (permissionsChanged) await assertRoleMembersBelow(actor, role);
  if (Types.ObjectId.isValid(actor.userId)) set.updatedBy = new Types.ObjectId(actor.userId);

  const updated = await TeamRole.findByIdAndUpdate(role._id, { $set: set }, { new: true }).lean<RoleRow>();
  if (!updated) throw new NotFoundError("Role");
  const reapplied = permissionsChanged ? await reapplyTeamRole(updated) : 0;
  await audit(auditContext, {
    action: permissionsChanged || assignableRoleIds ? "PERMISSION_CHANGE" : "UPDATE",
    resource: "teamRole",
    resourceId: String(role._id),
    resourceName: updated.name,
    changes: {
      before: {
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        assignableRoleIds: (role.assignableRoleIds ?? []).map(String),
      },
      after: {
        name: updated.name,
        description: updated.description,
        permissions: updated.permissions,
        assignableRoleIds: (updated.assignableRoleIds ?? []).map(String),
      },
      fields: Object.keys(set).filter((field) => field !== "updatedBy"),
      summary: permissionsChanged
        ? `Changed the ${updated.name} role's permissions (${reapplied} member${reapplied === 1 ? "" : "s"} updated)`
        : assignableRoleIds
          ? `Changed which roles the ${updated.name} role can give`
          : `Edited the ${updated.name} role`,
    },
  });
  return view(updated, await memberCountOf(updated));
}

export async function deleteTeamRole(
  id: string,
  actor: TeamAccess,
  auditContext: AuditContext,
): Promise<void> {
  const role = await loadRole(id);
  if (role.builtIn) throw new ValidationError("A built-in role cannot be deleted");
  assertNotOwnRole(actor, role);
  assertWithinActor(actor, {
    fullAccess: Boolean(role.allPermissions),
    permissions: sanitizeTeamPermissions(role.permissions, role.tier),
  });
  const members = await memberCountOf(role);
  if (members > 0) {
    throw new ConflictError(
      `${members} member${members === 1 ? " has" : "s have"} this role. Give them another role first.`,
      { members },
    );
  }
  await TeamRole.deleteOne({ _id: role._id });
  // No role keeps giving one that is gone.
  await TeamRole.updateMany({ assignableRoleIds: role._id }, { $pull: { assignableRoleIds: role._id } });
  await audit(auditContext, {
    action: "DELETE",
    resource: "teamRole",
    resourceId: String(role._id),
    resourceName: role.name,
    changes: { before: { name: role.name, tier: role.tier, permissions: role.permissions }, summary: `Deleted the ${role.name} role` },
  });
}
