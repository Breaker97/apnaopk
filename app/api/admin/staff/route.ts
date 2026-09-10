import { z } from "zod";
import { User, StaffProfile, AdminProfile } from "@/models";
import {
  createdResponse,
  paginatedResponse,
} from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { USER_ROLES, type UserRole } from "@/config/app.config";
import { validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { createAuditContext, auditCreate } from "@/lib/audit";
import {
  ADMIN_PERMISSIONS,
  ALL_STAFF_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
} from "@/config/permissions.config";
import type { StaffPermission } from "@/config/permissions.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { STAFF_MANAGED_BY } from "@/lib/access/staff-ownership";
import { Types } from "mongoose";
import { withApi } from "@/lib/api/handler";
import { fetchStaffList } from "@/lib/access/staff-list";

/**
 * GET /api/admin/staff
 * List all staff members with their profiles
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:staff:list", preset: "lenient" },
  },
  async ({ request }) => {
    const { page, limit, search } = validateQuery(
      request,
      AdminListQuerySchema,
    );

    const status = request.nextUrl.searchParams.get("status") || undefined;

    const list = await fetchStaffList({ page, limit, search, status });

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);

/**
 * POST /api/admin/staff
 * Create a new team member — an administrator or a staff member.
 */
export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:staff:create", preset: "moderate" },
  },
  async ({ request, session }) => {
    const body = await request.json();
    const {
      name,
      email,
      phone,
      status,
      permissions,
      vendorIds,
      locationIds,
      fulfillmentRegions,
      department,
      notes,
      isActive,
    } = body;

    // Anything other than an explicit "admin" creates staff, so an old client
    // that never sends the field keeps its behavior.
    const role: UserRole =
      body.role === USER_ROLES.ADMIN ? USER_ROLES.ADMIN : USER_ROLES.STAFF;

    if (!name?.trim()) throw new ValidationError("Name is required");
    if (!email?.trim()) throw new ValidationError("Email is required");

    const normalizedEmail = String(email).toLowerCase().trim();
    if (!z.string().email().safeParse(normalizedEmail).success) {
      throw new ValidationError("Invalid email address");
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      email: normalizedEmail,
    }).lean();

    let userId: string;
    const hasValidStatus = ["active", "inactive", "banned"].includes(status);

    if (existingUser) {
      // A team member's role is changed from their edit page, where the owner
      // and last-admin guards run — not by re-creating them.
      if (
        isStaffRole(existingUser.role) ||
        existingUser.role === USER_ROLES.ADMIN
      ) {
        throw new ValidationError("This user is already a team member");
      }
      if (existingUser.role === USER_ROLES.VENDOR) {
        throw new ValidationError(
          `This user already has the ${existingUser.role} role`,
        );
      }
      // Convert the customer to the requested team role
      const userUpdate: Record<string, unknown> = {
        role,
        roles: [role],
      };
      if (name?.trim()) userUpdate.name = name.trim();
      if (phone !== undefined) userUpdate.phone = phone?.trim() || undefined;
      if (hasValidStatus) userUpdate.status = status;

      await User.updateOne(
        { _id: existingUser._id },
        { $set: userUpdate },
      );
      userId = existingUser._id.toString();
    } else {
      const newUserPayload: Record<string, unknown> = {
        name: name.trim(),
        email: normalizedEmail,
        phone: phone?.trim() || undefined,
        role,
        roles: [role],
        emailVerified: false,
      };
      if (hasValidStatus) {
        newUserPayload.status = status;
      }

      const newUser = await User.create({
        ...newUserPayload,
      });
      userId = newUser._id.toString();
    }

    let staffProfile = null;
    if (role === USER_ROLES.ADMIN) {
      // Administrators bypass the staff permission system entirely, so they
      // get an AdminProfile (the shape the install wizard writes) and no
      // StaffProfile. `isSuperAdmin` stays false — Owner is only ever the
      // install wizard's first admin or the migration backfill.
      await AdminProfile.updateOne(
        { userId },
        {
          $setOnInsert: {
            userId,
            permissions: Object.values(ADMIN_PERMISSIONS),
            isSuperAdmin: false,
            department: department?.trim() || undefined,
          },
        },
        { upsert: true },
      );
    } else {
      // Check if staff profile already exists
      const existingProfile = await StaffProfile.findOne({ userId });
      if (existingProfile) {
        throw new ValidationError("Staff profile already exists for this user");
      }

      const staffPermissions = sanitizeStaffPermissions(permissions);

      staffProfile = await StaffProfile.create({
        userId,
        permissions:
          staffPermissions.length > 0
            ? staffPermissions
            : DEFAULT_STAFF_PERMISSIONS,
        // Platform-owned even when scoped to vendors: `vendorIds` here limits
        // what data this staff member sees, it does not hand them to a vendor.
        managedBy: STAFF_MANAGED_BY.PLATFORM,
        vendorIds: sanitizeObjectIdList(vendorIds),
        locationIds: sanitizeStringList(locationIds),
        fulfillmentRegions: sanitizeStringList(fulfillmentRegions),
        assignedBy: session.user.id,
        department: department?.trim() || undefined,
        notes: notes?.trim() || undefined,
        isActive: typeof isActive === "boolean" ? isActive : true,
      });
    }

    const user = await User.findById(userId)
      .select("name email image phone status role createdAt")
      .lean();

    const auditContext = createAuditContext(request, session);
    await auditCreate(
      auditContext,
      "user",
      userId,
      { name: name?.trim(), email: normalizedEmail, role },
      normalizedEmail,
    );

    return createdResponse({
      ...user,
      staffProfile,
    });
  },
);

function sanitizeStaffPermissions(input: unknown): StaffPermission[] {
  if (!Array.isArray(input)) return [];
  const valid = input.filter(
    (permission: unknown): permission is StaffPermission =>
      typeof permission === "string" &&
      ALL_STAFF_PERMISSIONS.includes(permission as StaffPermission),
  );
  return Array.from(new Set(valid));
}

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
