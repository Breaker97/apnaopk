import { AdminProfile, User } from "@/models";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";

/**
 * Team change guards — who may change whom on the admin Team page.
 *
 * The store has one Owner: the administrator whose AdminProfile carries
 * `isSuperAdmin` (stamped by the install wizard on the first admin, backfilled
 * by db:migrate team-roles for stores that predate the wizard). Ownership is a
 * designation on an admin account, deliberately NOT a fourth role in
 * USER_ROLES — every role guard in the app checks `admin`, and a separate role
 * would have to be threaded through all of them for zero enforcement gain.
 *
 * The rules are pure functions over a loaded context so they can be pinned by
 * tests and read in one place; the DB lookups that build the context live
 * below. Three invariants:
 *
 *  1. The Owner is untouchable — no role change, no suspension, no removal,
 *     by anyone. Ownership transfer is a deliberate non-feature: it would be
 *     an account-security event, not a team edit.
 *  2. Nobody edits their own role or status — an admin who demotes or
 *     suspends themself is locked out with no one left to undo it.
 *  3. The store keeps at least one working administrator — the last active
 *     admin cannot be demoted, suspended, or removed. With an Owner stamped
 *     this is already implied by rule 1, but unmigrated databases have no
 *     Owner row, and rule 3 keeps them safe too.
 */

export type TeamRole =
  | typeof USER_ROLES.ADMIN
  | typeof USER_ROLES.STAFF;

export interface TeamChangeContext {
  actorUserId: string;
  targetUserId: string;
  /** Target's current primary role. */
  targetRole: string;
  /** Target holds the Owner designation (AdminProfile.isSuperAdmin). */
  targetIsOwner: boolean;
  /** Active administrators other than the target. */
  otherActiveAdminCount: number;
}

type TeamChangeDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

const allowed = { allowed: true } as const;

function refuse(reason: string): TeamChangeDecision {
  return { allowed: false, reason };
}

export function decideTeamRoleChange(
  ctx: TeamChangeContext,
  newRole: TeamRole,
): TeamChangeDecision {
  if (ctx.targetRole === newRole) return allowed;
  if (ctx.targetIsOwner) {
    return refuse("The owner's role cannot be changed");
  }
  if (ctx.actorUserId === ctx.targetUserId) {
    return refuse("You cannot change your own role");
  }
  if (
    ctx.targetRole === USER_ROLES.ADMIN &&
    newRole !== USER_ROLES.ADMIN &&
    ctx.otherActiveAdminCount === 0
  ) {
    return refuse("The store must keep at least one active administrator");
  }
  return allowed;
}

export function decideTeamStatusChange(
  ctx: TeamChangeContext,
  newStatus: string,
): TeamChangeDecision {
  if (ctx.targetIsOwner) {
    return refuse("The owner's account status cannot be changed");
  }
  if (ctx.actorUserId === ctx.targetUserId) {
    return refuse("You cannot change your own account status");
  }
  if (
    ctx.targetRole === USER_ROLES.ADMIN &&
    newStatus !== USER_ACCOUNT_STATUS.ACTIVE &&
    ctx.otherActiveAdminCount === 0
  ) {
    return refuse("The store must keep at least one active administrator");
  }
  return allowed;
}

export function decideTeamRemoval(ctx: TeamChangeContext): TeamChangeDecision {
  if (ctx.targetIsOwner) {
    return refuse("The owner account cannot be removed");
  }
  if (ctx.actorUserId === ctx.targetUserId) {
    return refuse("Cannot remove your own team access");
  }
  if (
    ctx.targetRole === USER_ROLES.ADMIN &&
    ctx.otherActiveAdminCount === 0
  ) {
    return refuse("The store must keep at least one active administrator");
  }
  return allowed;
}

/**
 * Direct role write for team transitions (promote, demote, remove).
 *
 * NOT `setUserRole`: that helper deliberately preserves admin membership in
 * `roles`, because its callers are vendor-lifecycle transitions that must
 * never strip administrator rights as a side effect. A team demotion or
 * removal is the one place admin membership must actually go away — routed
 * through `setUserRole`, a demoted admin kept `admin` in `roles` and stayed an
 * administrator to every guard. Callers run the decide* guards first.
 */
export async function setTeamMemberRole(
  userId: string,
  role: (typeof USER_ROLES)[keyof typeof USER_ROLES],
) {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        role,
        roles: [role],
        emailVerificationAudience: "customer",
      },
    },
  );
}

/** Whether this admin account holds the Owner designation. */
export async function isOwnerAdmin(userId: string): Promise<boolean> {
  const profile = await AdminProfile.findOne({ userId, isSuperAdmin: true })
    .select("_id")
    .lean();
  return profile !== null;
}

/** User IDs of Owner-designated admins, for annotating the team list. */
export async function getOwnerAdminUserIds(): Promise<string[]> {
  const profiles = await AdminProfile.find({ isSuperAdmin: true })
    .select("userId")
    .lean();
  return profiles.map((profile) => String(profile.userId));
}

/**
 * Active administrators other than the given user. Counts membership through
 * either `role` or `roles`, the same way `isAdmin` reads a session, and treats
 * a missing status as active the way the auth check does.
 */
async function countOtherActiveAdmins(
  excludeUserId: string,
): Promise<number> {
  return User.countDocuments({
    _id: { $ne: excludeUserId },
    $and: [
      {
        $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
      },
      {
        $or: [
          { status: USER_ACCOUNT_STATUS.ACTIVE },
          { status: { $exists: false } },
          { status: null },
        ],
      },
    ],
  });
}

/** Loads the guard context for one target. */
export async function loadTeamChangeContext(params: {
  actorUserId: string;
  targetUserId: string;
  targetRole: string;
}): Promise<TeamChangeContext> {
  const [targetIsOwner, otherActiveAdminCount] = await Promise.all([
    isOwnerAdmin(params.targetUserId),
    countOtherActiveAdmins(params.targetUserId),
  ]);
  return {
    actorUserId: params.actorUserId,
    targetUserId: params.targetUserId,
    targetRole: params.targetRole,
    targetIsOwner,
    otherActiveAdminCount,
  };
}
