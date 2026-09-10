import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { StaffProfile, User } from "@/models";
import { USER_ROLES } from "@/config/app.config";
import {
  ALL_STAFF_PERMISSIONS,
  VENDOR_PERMISSIONS,
  type StaffPermission,
} from "@/config/permissions.config";
import { setUserRole } from "@/lib/access/user-role";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError, handleApiError } from "@/lib/api/errors";
import { STAFF_USER_ROLES } from "@/lib/access/staff-role";
import { requireVendorStaffPermission } from "@/lib/access/vendor-staff-guard";
import {
  STAFF_MANAGED_BY,
  VENDOR_OWNED_STAFF_FILTER,
} from "@/lib/access/staff-ownership";
import { getDemoModeMutationResponse } from "@/lib/demo-mode";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

interface RouteParams {
  params: Promise<{ id: string }>;
}

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

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { vendor } = await requireVendorStaffPermission(
      request,
      [
        VENDOR_PERMISSIONS.VIEW_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
      ],
      "vendor:staff:read",
      "lenient",
    );

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return notFoundResponse("Staff member");

    // Ownership, not just membership: platform staff scoped to this vendor's
    // data carry it in `vendorIds` too, and must stay invisible here.
    const profile = await StaffProfile.findOne({
      userId: id,
      vendorIds: vendor._id,
      ...VENDOR_OWNED_STAFF_FILTER,
    })
      .populate("assignedBy", "name email")
      .lean();
    if (!profile) return notFoundResponse("Staff member");

    const user = await User.findOne({
      _id: id,
      role: { $in: STAFF_USER_ROLES },
    })
      .select("name email image phone status createdAt twoFactorEnabled +password")
      .lean();
    if (!user) return notFoundResponse("Staff member");

    return successResponse({ ...stripPassword(user), staffProfile: profile });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { vendor } = await requireVendorStaffPermission(
      request,
      [
        VENDOR_PERMISSIONS.EDIT_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
      ],
      "vendor:staff:update",
      "moderate",
    );

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return notFoundResponse("Staff member");

    const profile = await StaffProfile.findOne({
      userId: id,
      vendorIds: vendor._id,
      ...VENDOR_OWNED_STAFF_FILTER,
    }).lean();
    if (!profile) return notFoundResponse("Staff member");

    const user = await User.findOne({
      _id: id,
      role: { $in: STAFF_USER_ROLES },
    }).lean();
    if (!user) return notFoundResponse("Staff member");

    const body = await validateBody(request, StaffUpdateSchema);
    const {
      name,
      phone,
      status,
      permissions,
      department,
      jobTitle,
      startDate,
      notes,
      isActive,
    } = body;

    const userUpdate: Record<string, unknown> = {};
    if (name?.trim()) userUpdate.name = name.trim();
    if (phone !== undefined) userUpdate.phone = phone?.trim() || undefined;
    if (status && ["active", "inactive", "banned"].includes(status)) {
      userUpdate.status = status;
    }

    if (Object.keys(userUpdate).length > 0) {
      await User.updateOne({ _id: id }, { $set: userUpdate });
    }

    const profileUpdate: Record<string, unknown> = {};
    if (Array.isArray(permissions)) {
      profileUpdate.permissions = sanitizeStaffPermissions(permissions);
    }
    if (department !== undefined) {
      profileUpdate.department = department?.trim() || undefined;
    }
    if (jobTitle !== undefined) {
      profileUpdate.jobTitle = jobTitle?.trim() || undefined;
    }
    if (startDate !== undefined) {
      const parsed = startDate ? new Date(startDate) : null;
      profileUpdate.startDate =
        parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
    }
    if (notes !== undefined) profileUpdate.notes = notes?.trim() || undefined;
    if (typeof isActive === "boolean") profileUpdate.isActive = isActive;

    if (Object.keys(profileUpdate).length > 0) {
      // Only reachable for staff the ownership filter above matched, so
      // stamping converges legacy rows on the explicit value.
      profileUpdate.managedBy = STAFF_MANAGED_BY.VENDOR;
      await StaffProfile.updateOne({ userId: id }, { $set: profileUpdate });
    }

    const updatedUser = await User.findById(id)
      .select("name email image phone status createdAt twoFactorEnabled +password")
      .lean();
    const updatedProfile = await StaffProfile.findOne({ userId: id })
      .populate("assignedBy", "name email")
      .lean();

    return successResponse({
      ...stripPassword(updatedUser),
      staffProfile: updatedProfile,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { session, vendor } = await requireVendorStaffPermission(
      request,
      [
        VENDOR_PERMISSIONS.DELETE_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STAFF,
        VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
      ],
      "vendor:staff:delete",
      "strict",
    );

    const demoBlock = getDemoModeMutationResponse();
    if (demoBlock) return demoBlock;

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return notFoundResponse("Staff member");
    if (id === session.user.id) {
      throw new ValidationError("Cannot remove your own staff access");
    }

    const profile = await StaffProfile.findOne({
      userId: id,
      vendorIds: vendor._id,
      ...VENDOR_OWNED_STAFF_FILTER,
    }).lean();
    if (!profile) return notFoundResponse("Staff member");

    const remainingVendorIds = (profile.vendorIds || [])
      .map(String)
      .filter((vendorId: string) => vendorId !== String(vendor._id));

    if (remainingVendorIds.length > 0) {
      await StaffProfile.updateOne(
        { userId: id },
        { $set: { vendorIds: remainingVendorIds } },
      );
    } else {
      await StaffProfile.deleteOne({ userId: id });
      // Deliberately `setUserRole`, not `revokeVendorRole`. These accounts
      // hold `staff` and never `vendor` — POST /api/vendor/staff mints a new
      // user for the team and refuses to convert an existing one — so a
      // vendor-membership revoke would find nothing to remove and leave a
      // `staff` role behind with no StaffProfile under it: locked out of the
      // staff area and bounced from /account.
      await setUserRole(id, USER_ROLES.CUSTOMER);
    }

    return successResponse({ message: "Staff member removed successfully" });
  } catch (error) {
    return handleApiError(error);
  }
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

/** Whether the invite has been accepted, without leaking the hash. */
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
