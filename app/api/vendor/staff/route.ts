import { NextRequest } from "next/server";
import * as z from "zod";
import { StaffProfile, User } from "@/models";
import { USER_ROLES } from "@/config/app.config";
import {
  DEFAULT_STAFF_PERMISSIONS,
  VENDOR_PERMISSIONS,
} from "@/config/permissions.config";
import { checkPlanLimit } from "@/lib/vendors/vendor-limits";
import { validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { createdResponse, paginatedResponse } from "@/lib/api/response";
import { fetchStaffList } from "@/lib/access/staff-list";
import { ValidationError, handleApiError } from "@/lib/api/errors";
import { isStaffRole } from "@/lib/access/staff-role";
import { STAFF_MANAGED_BY } from "@/lib/access/staff-ownership";
import { requireVendorStaffPermission } from "@/lib/access/vendor-staff-guard";
import { sanitizeVendorStaffPermissions } from "@/lib/access/staff-authz";
import { auditStaffCreated } from "@/lib/access/audit-staff";
import { createAuditContext } from "@/lib/audit";

export async function GET(request: NextRequest) {
  try {
    const { vendor } = await requireVendorStaffPermission(
      request,
      [
        VENDOR_PERMISSIONS.VIEW_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
      ],
      "vendor:staff:list",
      "lenient",
    );

    const { page, limit, search } = validateQuery(request, AdminListQuerySchema);
    const statusParam = request.nextUrl.searchParams.get("status");
    const list = await fetchStaffList(
      { page, limit, search, status: statusParam || undefined },
      { vendorId: vendor._id },
    );

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { session, vendor } = await requireVendorStaffPermission(
      request,
      [
        VENDOR_PERMISSIONS.CREATE_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
      ],
      "vendor:staff:create",
      "moderate",
    );

    // Enforce the plan's staff cap BEFORE creating any User/StaffProfile — a
    // gate placed after User.create() would leave an orphan user on rejection.
    const staffLimit = await checkPlanLimit(vendor._id, "staff", {
      planId: vendor.planId,
    });
    if (!staffLimit.allowed) {
      throw new ValidationError(
        `Your plan allows up to ${staffLimit.limit} staff members (you have ${staffLimit.current}). Upgrade your plan to add more.`,
      );
    }

    const body = await request.json();
    const {
      name,
      email,
      phone,
      status,
      permissions,
      department,
      notes,
      isActive,
    } = body;

    if (!name?.trim()) throw new ValidationError("Name is required");
    if (!email?.trim()) throw new ValidationError("Email is required");

    const normalizedEmail = String(email).toLowerCase().trim();
    if (!z.string().email().safeParse(normalizedEmail).success) {
      throw new ValidationError("Invalid email address");
    }
    const existingUser = await User.findOne({ email: normalizedEmail }).lean();
    const hasValidStatus = ["active", "inactive", "banned"].includes(status);

    // An account that already exists belongs to whoever signed up with it. A
    // vendor typing that address must not be able to convert it: doing so
    // replaced the owner's customer role (wiping `roles`), handed this vendor's
    // orders and inventory to someone who never agreed, and dropped them on a
    // staff dashboard at their next sign-in. Converting an existing account
    // stays an admin action (app/api/admin/staff), where the caller is trusted.
    if (existingUser) {
      if (isStaffRole(existingUser.role)) {
        throw new ValidationError("This user is already a staff member");
      }
      if (
        existingUser.role === USER_ROLES.ADMIN ||
        existingUser.role === USER_ROLES.VENDOR
      ) {
        throw new ValidationError(
          `This user already has the ${existingUser.role} role`,
        );
      }
      throw new ValidationError(
        "Someone already has an account with that email. Use a different address for this staff member, or ask an admin to convert the existing account.",
      );
    }

    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone?.trim() || undefined,
      role: USER_ROLES.STAFF,
      roles: [USER_ROLES.STAFF],
      emailVerified: false,
      ...(hasValidStatus ? { status } : {}),
    });
    const userId = String(newUser._id);

    const existingProfile = await StaffProfile.findOne({ userId });
    if (existingProfile) {
      throw new ValidationError("Staff profile already exists for this user");
    }

    const staffPermissions = sanitizeVendorStaffPermissions(permissions);
    const staffProfile = await StaffProfile.create({
      userId,
      permissions:
        staffPermissions.length > 0
          ? staffPermissions
          : DEFAULT_STAFF_PERMISSIONS,
      managedBy: STAFF_MANAGED_BY.VENDOR,
      vendorIds: [vendor._id],
      assignedBy: session.user.id,
      department: department?.trim() || undefined,
      notes: notes?.trim() || undefined,
      isActive: typeof isActive === "boolean" ? isActive : true,
    });

    // The member as stored, not as asked for: the audit row must show the
    // defaults the account and its profile actually received.
    await auditStaffCreated(
      createAuditContext(request, session, { vendorId: vendor._id }),
      { userId, name: newUser.name, email: newUser.email },
      {
        status: newUser.status ?? "active",
        isActive: staffProfile.isActive,
        permissions: staffProfile.permissions,
        department: staffProfile.department,
        vendorIds: [String(vendor._id)],
      },
    );

    const user = await User.findById(userId)
      .select("name email image phone status createdAt")
      .lean();

    return createdResponse({ ...user, staffProfile });
  } catch (error) {
    return handleApiError(error);
  }
}
