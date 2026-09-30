import { connectDB } from "@/lib/db";
import { User, Vendor } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { AdminUpdateUserSchema } from "@/lib/validations";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  createAuditContext,
  auditRoleChange,
  auditDelete,
  auditUpdate,
} from "@/lib/audit";
import { withApi } from "@/lib/api/handler";
import { cleanupDeletedUserReferences } from "@/lib/customers/user-cleanup";
import { setUserRole } from "@/lib/access/user-role";
import { isStaffRole } from "@/lib/access/staff-role";
import {
  decideTeamRemoval,
  decideTeamStatusChange,
  loadTeamChangeContext,
} from "@/lib/access/team-roles";
import { revokeAllSessions } from "@/lib/auth/session-revocation";

/**
 * This screen changes shoppers and sellers. An administrator's role is
 * changed on the Team page, which keeps the owner untouchable and the store
 * one working administrator; here a demotion wrote `role` alone, the admin
 * membership in `roles` survived it, and the "demoted" admin kept every
 * right. Bans and removals of an administrator follow the Team rules too.
 */
const TEAM_ROLE_HERE =
  "Administrators and team members are changed from Settings → Team, where the owner and last-administrator rules are kept.";

function holdsAdmin(user: { role?: string | null; roles?: string[] | null }) {
  return (
    user.role === USER_ROLES.ADMIN ||
    (user.roles ?? []).includes(USER_ROLES.ADMIN)
  );
}

/**
 * GET /api/admin/users/[id]
 * Get single user
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const { id } = params;

    // Validate ID format
    if (!isValidObjectId(id)) {
      return notFoundResponse("User");
    }

    await connectDB();

    const user = await User.findById(id).select("-password").lean();

    if (!user) {
      return notFoundResponse("User");
    }

    return successResponse(user);
  },
);

/**
 * PUT /api/admin/users/[id]
 * Update user (role, status, etc.)
 */
export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    const { id } = params;

    // Validate ID format
    if (!isValidObjectId(id)) {
      return notFoundResponse("User");
    }

    // Rate limiting - user updates are sensitive
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:users:update",
      "moderate",
      session.user.role
    );

    // Validate request body
    const updates = await validateBody(request, AdminUpdateUserSchema);

    // Prevent admin from modifying themselves via this endpoint
    if (id === session.user.id) {
      throw new AuthorizationError(
        "Cannot update your own account via this endpoint"
      );
    }

    await connectDB();

    // Get user before update for audit logging
    const userBefore = await User.findById(id).select("-password").lean();
    if (!userBefore) {
      return notFoundResponse("User");
    }

    // Filter to allowed updates only
    const allowedUpdates: Record<string, unknown> = {};
    const roleChange =
      updates.role && updates.role !== userBefore.role ? updates.role : null;
    if (roleChange) {
      if (
        holdsAdmin(userBefore) ||
        isStaffRole(userBefore.role) ||
        (roleChange !== USER_ROLES.CUSTOMER && roleChange !== USER_ROLES.VENDOR)
      ) {
        throw new AuthorizationError(TEAM_ROLE_HERE);
      }
    }
    if (updates.name) allowedUpdates.name = updates.name;
    if (updates.phone !== undefined) allowedUpdates.phone = updates.phone;
    if (updates.status && Object.values(USER_ACCOUNT_STATUS).includes(updates.status)) {
      allowedUpdates.status = updates.status;
    } else if (typeof updates.banned === "boolean") {
      allowedUpdates.status = updates.banned
        ? USER_ACCOUNT_STATUS.BANNED
        : USER_ACCOUNT_STATUS.ACTIVE;
    }
    const statusChange =
      allowedUpdates.status !== undefined &&
      allowedUpdates.status !== (userBefore.status || USER_ACCOUNT_STATUS.ACTIVE)
        ? String(allowedUpdates.status)
        : null;
    if (statusChange && holdsAdmin(userBefore)) {
      const decision = decideTeamStatusChange(
        await loadTeamChangeContext({
          actorUserId: session.user.id,
          targetUserId: id,
          targetRole: USER_ROLES.ADMIN,
        }),
        statusChange,
      );
      if (!decision.allowed) throw new AuthorizationError(decision.reason);
    }

    // `role` and `roles` together, as every other role write does.
    if (roleChange) await setUserRole(id, roleChange);
    const user = await User.findByIdAndUpdate(
      id,
      { $set: allowedUpdates },
      { returnDocument: "after" }
    ).select("-password");
    // A banned or suspended account's open sessions end now, not on their
    // next request's status check.
    if (statusChange && statusChange !== USER_ACCOUNT_STATUS.ACTIVE) {
      await revokeAllSessions(id).catch((error) =>
        console.error(`Failed to sign out suspended user ${id}:`, error),
      );
    }

    if (!user) {
      return notFoundResponse("User");
    }

    // Audit logging
    const auditContext = createAuditContext(request, session);

    // Special audit for role changes
    if (roleChange) {
      await auditRoleChange(
        auditContext,
        id,
        userBefore.role,
        roleChange,
        userBefore.email
      );
    } else if (Object.keys(allowedUpdates).length > 0) {
      // General update audit
      await auditUpdate(
        auditContext,
        "user",
        id,
        userBefore as unknown as Record<string, unknown>,
        user.toObject() as unknown as Record<string, unknown>,
        userBefore.email
      );
    }

    return successResponse(user);
  },
);

/**
 * DELETE /api/admin/users/[id]
 * Delete user
 */
export const DELETE = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    const { id } = params;

    // Validate ID format
    if (!isValidObjectId(id)) {
      return notFoundResponse("User");
    }

    // Rate limiting - deletions are very sensitive
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:users:delete",
      "strict",
      session.user.role
    );

    if (id === session.user.id) {
      throw new AuthorizationError("Cannot delete yourself");
    }

    await connectDB();

    // Get user before deletion for audit logging
    const user = await User.findById(id).select("-password").lean();
    if (!user) {
      return notFoundResponse("User");
    }

    if (holdsAdmin(user)) {
      const decision = decideTeamRemoval(
        await loadTeamChangeContext({
          actorUserId: session.user.id,
          targetUserId: id,
          targetRole: USER_ROLES.ADMIN,
        }),
      );
      if (!decision.allowed) throw new AuthorizationError(decision.reason);
    }

    // A user who owns a vendor account must be deleted through the vendor
    // flow first — deleting here would orphan the Vendor (and its products,
    // coupons, and payout linkage) behind a ghost userId.
    const ownedVendor = await Vendor.findOne({ userId: id })
      .select("_id storeName")
      .lean();
    if (ownedVendor) {
      throw new ValidationError(
        "This user owns a vendor account. Delete or reassign the vendor first (Admin → Vendors).",
      );
    }

    await User.findByIdAndDelete(id);

    // Remove owned documents (profiles, carts, wishlists, notifications,
    // push subscriptions, reviews) so nothing references a ghost user.
    await cleanupDeletedUserReferences(id);

    // Audit log the deletion
    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "user",
      id,
      {
        email: user.email,
        name: user.name,
        role: user.role,
      },
      user.email
    );

    return successResponse({ message: "User deleted successfully" });
  },
);
