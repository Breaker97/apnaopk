import { connectDB } from "@/lib/db";
import { StaffProfile, User } from "@/models";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import type { StaffPermission } from "@/config/permissions.config";
import { AuthorizationError } from "@/lib/api/errors";
import {
  EMPTY_STAFF_SCOPE,
  normalizeStaffScope,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";

type MinimalSession = {
  user: {
    id: string;
    role: string;
  };
};

export async function getActiveStaffAccess(userId: string): Promise<{
  permissions: StaffPermission[];
  scope: StaffAccessScope;
}> {
  await connectDB();
  const [profile, user] = await Promise.all([
    StaffProfile.findOne({ userId, isActive: true })
      .select("permissions vendorIds locationIds fulfillmentRegions")
      .lean(),
    User.findById(userId).select("status").lean(),
  ]);
  const status = (user as { status?: string } | null)?.status;
  if (
    status &&
    status !== USER_ACCOUNT_STATUS.ACTIVE
  ) {
    return { permissions: [], scope: EMPTY_STAFF_SCOPE };
  }
  const staffProfile =
    profile as {
      permissions?: unknown;
      vendorIds?: unknown[];
      locationIds?: unknown[];
      fulfillmentRegions?: unknown[];
    } | null;
  const perms = staffProfile?.permissions;
  return {
    permissions: Array.isArray(perms) ? (perms as StaffPermission[]) : [],
    scope: normalizeStaffScope({
      vendorIds: staffProfile?.vendorIds?.map(String),
      locationIds: staffProfile?.locationIds?.map(String),
      fulfillmentRegions: staffProfile?.fulfillmentRegions?.map(String),
    }),
  };
}

export async function assertAdminOrStaffPermissions(
  session: MinimalSession,
  required: StaffPermission[] | undefined,
  mode: "any" | "all" = "any",
): Promise<{
  staffPermissions?: StaffPermission[];
  staffScope?: StaffAccessScope;
}> {
  if (session.user.role === USER_ROLES.ADMIN) return {};
  if (
    session.user.role !== USER_ROLES.STAFF &&
    session.user.role !== USER_ROLES.SELLER
  ) {
    throw new AuthorizationError();
  }

  const { permissions: staffPermissions, scope: staffScope } =
    await getActiveStaffAccess(session.user.id);
  if (!required?.length) return { staffPermissions, staffScope };

  const ok =
    mode === "all"
      ? required.every((p) => staffPermissions.includes(p))
      : required.some((p) => staffPermissions.includes(p));

  if (!ok) throw new AuthorizationError();
  return { staffPermissions, staffScope };
}
