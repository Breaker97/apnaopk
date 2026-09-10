import { connectDB } from "@/lib/db";
import { User, StaffProfile, AdminProfile } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { USER_ROLES } from "@/config/app.config";
import {
  createAuditContext,
  auditUpdate,
  auditDelete,
  auditRoleChange,
} from "@/lib/audit";
import { Types } from "mongoose";
import {
  ADMIN_PERMISSIONS,
  ALL_STAFF_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
} from "@/config/permissions.config";
import type { StaffPermission } from "@/config/permissions.config";
import { TEAM_USER_ROLES, isStaffRole } from "@/lib/access/staff-role";
import {
  decideTeamRemoval,
  decideTeamRoleChange,
  decideTeamStatusChange,
  isOwnerAdmin,
  loadTeamChangeContext,
  setTeamMemberRole,
  type TeamRole,
} from "@/lib/access/team-roles";
import { STAFF_MANAGED_BY, isVendorOwnedStaff } from "@/lib/access/staff-ownership";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

// Shape check only; role/status transitions and permission grants are
// validated against the team guards below.
const StaffUpdateSchema = z
  .object({
    name: z.string().max(200).optional(),
    phone: z.string().max(50).nullable().optional(),
    status: z.string().max(20).optional(),
    role: z.string().max(20).optional(),
    permissions: z.array(z.string().max(80)).max(200).optional(),
    vendorIds: z.array(z.string().max(64)).max(200).optional(),
    locationIds: z.array(z.string().max(64)).max(200).optional(),
    fulfillmentRegions: z.array(z.string().max(120)).max(200).optional(),
    department: z.string().max(120).nullable().optional(),
    jobTitle: z.string().max(120).nullable().optional(),
    startDate: z.string().max(40).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .loose();

/**
 * GET /api/admin/staff/[id]
 * Get a single team member (administrator or staff) with their profile
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Team member");
    }

    await connectDB();

    // id is the user _id
    const user = await User.findOne({
      _id: id,
      role: { $in: TEAM_USER_ROLES },
    })
      // `+password` is read only to answer "has this account been set up yet?"
      // — the hash itself is stripped before the response is built.
      .select(
        "name email image phone status role createdAt twoFactorEnabled +password",
      )
      .lean();

    if (!user) {
      return notFoundResponse("Team member");
    }

    // Vendor-owned staff are out of scope for the admin.
    if (await isVendorOwnedStaff(id)) {
      return notFoundResponse("Team member");
    }

    const [staffProfile, isOwner] = await Promise.all([
      StaffProfile.findOne({ userId: id })
        .populate("assignedBy", "name email")
        .lean(),
      isOwnerAdmin(id),
    ]);

    return successResponse({
      ...stripPassword(user),
      isOwner,
      staffProfile: staffProfile || null,
    });
  },
);

/**
 * PUT /api/admin/staff/[id]
 * Update a team member — profile fields, permissions, status, and role
 * (promote staff to administrator or demote an administrator to staff).
 */
export const PUT = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:staff:update", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Team member");
    }

    await connectDB();

    const user = await User.findOne({
      _id: id,
      role: { $in: TEAM_USER_ROLES },
    }).lean();

    if (!user) {
      return notFoundResponse("Team member");
    }

    // Vendor-owned staff are out of scope for the admin.
    if (await isVendorOwnedStaff(id)) {
      return notFoundResponse("Team member");
    }

    const body = await validateBody(request, StaffUpdateSchema);
    const {
      name,
      phone,
      status,
      permissions,
      vendorIds,
      locationIds,
      fulfillmentRegions,
      department,
      jobTitle,
      startDate,
      notes,
      isActive,
    } = body;

    // Role and status changes run the team guards (owner, self, last admin).
    // Both are gated on an actual change: the form always echoes the current
    // values back, and an echo must not trip a guard.
    const requestedRole: TeamRole | undefined =
      body.role === USER_ROLES.ADMIN
        ? USER_ROLES.ADMIN
        : body.role === USER_ROLES.STAFF
          ? USER_ROLES.STAFF
          : undefined;
    // `seller` is legacy staff — an echo of "staff" for a seller row is a
    // canonicalization, not a transition, and skips the guards.
    const wantsRoleChange =
      requestedRole !== undefined &&
      requestedRole !== user.role &&
      !(requestedRole === USER_ROLES.STAFF && isStaffRole(user.role));

    const validStatus =
      status && ["active", "inactive", "banned"].includes(status)
        ? status
        : undefined;
    const wantsStatusChange =
      validStatus !== undefined && validStatus !== (user.status || "active");

    if (wantsRoleChange || wantsStatusChange) {
      const ctx = await loadTeamChangeContext({
        actorUserId: session.user.id,
        targetUserId: id,
        targetRole: user.role,
      });
      if (wantsRoleChange) {
        const decision = decideTeamRoleChange(ctx, requestedRole!);
        if (!decision.allowed) throw new ValidationError(decision.reason);
      }
      if (wantsStatusChange) {
        const decision = decideTeamStatusChange(ctx, validStatus);
        if (!decision.allowed) throw new ValidationError(decision.reason);
      }
    }

    // Update user fields
    const userUpdate: Record<string, unknown> = {};
    if (name?.trim()) userUpdate.name = name.trim();
    if (phone !== undefined) userUpdate.phone = phone?.trim() || undefined;
    if (wantsStatusChange) userUpdate.status = validStatus;

    if (Object.keys(userUpdate).length > 0) {
      await User.updateOne({ _id: id }, { $set: userUpdate });
    }

    const auditContext = createAuditContext(request, session);

    // Written whenever the stored role differs — that covers a real
    // transition and the guard-exempt seller→staff canonicalization alike.
    if (requestedRole !== undefined && requestedRole !== user.role) {
      // Direct write — see setTeamMemberRole for why not setUserRole.
      await setTeamMemberRole(id, requestedRole);
      if (wantsRoleChange) {
        await auditRoleChange(auditContext, id, user.role, requestedRole, user.email);
      }
    }

    const finalRole = requestedRole ?? user.role;

    if (finalRole === USER_ROLES.ADMIN) {
      // Administrators sit outside the staff permission system; make sure the
      // profile the admin dashboard reads exists, and ignore any staff
      // permission fields the client sent.
      await AdminProfile.updateOne(
        { userId: id },
        {
          $setOnInsert: {
            userId: id,
            permissions: Object.values(ADMIN_PERMISSIONS),
            isSuperAdmin: false,
          },
          ...(department !== undefined
            ? { $set: { department: department?.trim() || undefined } }
            : {}),
        },
        { upsert: true },
      );
    } else {
      if (wantsRoleChange) {
        // Demoted administrators lose the admin profile and need a staff one
        // to hold their permissions; a returning staff member keeps whatever
        // profile they had before promotion.
        await AdminProfile.deleteOne({ userId: id });
      }

      // Update staff profile
      const profileUpdate: Record<string, unknown> = {};
      if (Array.isArray(permissions)) {
        const validPerms = permissions.filter((p: string) =>
          ALL_STAFF_PERMISSIONS.includes(p as StaffPermission),
        );
        profileUpdate.permissions = validPerms;
      }
      if (Array.isArray(vendorIds)) {
        profileUpdate.vendorIds = sanitizeObjectIdList(vendorIds);
      }
      if (Array.isArray(locationIds)) {
        profileUpdate.locationIds = sanitizeStringList(locationIds);
      }
      if (Array.isArray(fulfillmentRegions)) {
        profileUpdate.fulfillmentRegions = sanitizeStringList(fulfillmentRegions);
      }
      if (department !== undefined)
        profileUpdate.department = department?.trim() || undefined;
      if (jobTitle !== undefined)
        profileUpdate.jobTitle = jobTitle?.trim() || undefined;
      if (startDate !== undefined) {
        // An empty string clears the date; anything unparseable is ignored
        // rather than stored as `Invalid Date`.
        const parsed = startDate ? new Date(startDate) : null;
        profileUpdate.startDate =
          parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
      }
      if (notes !== undefined) profileUpdate.notes = notes?.trim() || undefined;
      if (typeof isActive === "boolean") profileUpdate.isActive = isActive;

      if (Object.keys(profileUpdate).length > 0 || wantsRoleChange) {
        // Only reachable for team members the ownership check above let
        // through, so stamping is safe — and it keeps a legacy row
        // platform-owned even when this write grants it a vendor scope.
        profileUpdate.managedBy = STAFF_MANAGED_BY.PLATFORM;
        const setOnInsert: Record<string, unknown> = {
          userId: id,
          assignedBy: session.user.id,
        };
        if (!Array.isArray(profileUpdate.permissions)) {
          setOnInsert.permissions = DEFAULT_STAFF_PERMISSIONS;
        }
        await StaffProfile.updateOne(
          { userId: id },
          { $set: profileUpdate, $setOnInsert: setOnInsert },
          { upsert: true },
        );
      }
    }

    // Audit
    await auditUpdate(
      auditContext,
      "user",
      id,
      { user, role: user.role } as unknown as Record<string, unknown>,
      {
        ...userUpdate,
        ...(wantsRoleChange ? { role: requestedRole } : {}),
      } as unknown as Record<string, unknown>,
      user.email,
    );

    // Return updated data
    const updatedUser = await User.findById(id)
      .select(
        "name email image phone status role createdAt twoFactorEnabled +password",
      )
      .lean();
    const updatedProfile = await StaffProfile.findOne({ userId: id })
      .populate("assignedBy", "name email")
      .lean();

    return successResponse({
      ...stripPassword(updatedUser),
      staffProfile: updatedProfile,
    });
  },
);

/**
 * DELETE /api/admin/staff/[id]
 * Remove a team member — role and profiles go, the account reverts to customer.
 */
export const DELETE = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:staff:delete", preset: "strict" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Team member");
    }

    await connectDB();

    const user = await User.findOne({
      _id: id,
      role: { $in: TEAM_USER_ROLES },
    }).lean();

    if (!user) {
      return notFoundResponse("Team member");
    }

    // Vendor-owned staff are out of scope for the admin.
    if (await isVendorOwnedStaff(id)) {
      return notFoundResponse("Team member");
    }

    const ctx = await loadTeamChangeContext({
      actorUserId: session.user.id,
      targetUserId: id,
      targetRole: user.role,
    });
    const decision = decideTeamRemoval(ctx);
    if (!decision.allowed) throw new ValidationError(decision.reason);

    // Revert to customer. Direct write, not setUserRole — a removed
    // administrator must actually lose admin membership in `roles`.
    await setTeamMemberRole(id, USER_ROLES.CUSTOMER);

    // Remove both profiles; a team member only ever has the one matching
    // their role, and deleting the other is a no-op.
    await Promise.all([
      StaffProfile.deleteOne({ userId: id }),
      AdminProfile.deleteOne({ userId: id }),
    ]);

    // Audit
    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "user",
      id,
      { name: user.name, email: user.email, action: "team_member_removed" },
      user.email,
    );

    return successResponse({ message: "Team member removed successfully" });
  },
);

function sanitizeObjectIdList(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => String(value || "").trim())
        .filter((value) => Types.ObjectId.isValid(value)),
    ),
  );
}

function sanitizeStringList(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

/**
 * Swap the password hash for the one bit the UI needs: whether the staff
 * member has finished their invite. The hash must never leave the server.
 */
function stripPassword<T extends { password?: string | null } | null>(
  user: T,
): (Omit<NonNullable<T>, "password"> & { hasPassword: boolean }) | null {
  if (!user) return null;
  const { password, ...rest } = user;
  return { ...rest, hasPassword: Boolean(password) } as Omit<
    NonNullable<T>,
    "password"
  > & { hasPassword: boolean };
}
