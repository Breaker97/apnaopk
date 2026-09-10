import { NextRequest } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { StaffProfile, User } from "@/models";
import { getSettings } from "@/models/settings.model";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { USER_ROLES } from "@/config/app.config";
import {
  ALL_STAFF_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  VENDOR_PERMISSIONS,
  type StaffPermission,
  type VendorPermission,
} from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { checkPlanLimit } from "@/lib/vendors/vendor-limits";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { createdResponse, paginatedResponse } from "@/lib/api/response";
import { fetchStaffList } from "@/lib/access/staff-list";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  handleApiError,
} from "@/lib/api/errors";
import { isStaffRole } from "@/lib/access/staff-role";
import { STAFF_MANAGED_BY } from "@/lib/access/staff-ownership";
import { hasVendorPermission } from "@/lib/access/rbac";

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

    const staffPermissions = sanitizeStaffPermissions(permissions);
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

    const user = await User.findById(userId)
      .select("name email image phone status createdAt")
      .lean();

    return createdResponse({ ...user, staffProfile });
  } catch (error) {
    return handleApiError(error);
  }
}

async function requireVendorStaffPermission(
  request: NextRequest,
  permissions: VendorPermission[],
  limiterKey: string,
  limiterMode: "lenient" | "moderate" | "strict",
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AuthenticationError();
  if (session.user.role !== USER_ROLES.VENDOR) throw new AuthorizationError();

  await rateLimitByUser(
    request,
    session.user.id,
    limiterKey,
    limiterMode,
    session.user.role,
  );

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

  const vendor = await requireApprovedVendorByUserId(session.user.id);
  const ok = await Promise.all(
    permissions.map((permission) =>
      hasVendorPermission(
        session.user as unknown as { id?: string; role?: typeof USER_ROLES.VENDOR },
        permission,
      ),
    ),
  );
  if (!ok.some(Boolean)) throw new AuthorizationError();

  return { session, vendor };
}

function sanitizeStaffPermissions(input: unknown): StaffPermission[] {
  if (!Array.isArray(input)) return [];
  const valid = input.filter(
    (permission: unknown): permission is StaffPermission =>
      typeof permission === "string" &&
      ALL_STAFF_PERMISSIONS.includes(permission as StaffPermission),
  );
  return Array.from(new Set(valid));
}
