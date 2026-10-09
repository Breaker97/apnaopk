import { connectDB } from "@/lib/db";
import { Order, StaffProfile, User } from "@/models";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import {
  VENDOR_STAFF_LEGACY_GRANT_PARTS,
  VENDOR_STAFF_PERMISSIONS,
  VENDOR_STAFF_PLATFORM_ONLY_PERMISSIONS,
  type StaffPermission,
} from "@/config/permissions.config";
import { AuthorizationError } from "@/lib/api/errors";
import {
  EMPTY_STAFF_SCOPE,
  buildStaffOrderScopeFilter,
  hasStaffScope,
  isOrderEntirelyInScope,
  mergeScopeFilter,
  normalizeStaffScope,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import { isVendorOwnedStaffProfile } from "@/lib/access/staff-ownership";

type MinimalSession = {
  user: {
    id: string;
    role: string;
  };
};

/**
 * The permissions a staff profile actually carries: what was granted, minus
 * what a vendor's own staff can never hold (see
 * `VENDOR_STAFF_PLATFORM_ONLY_PERMISSIONS`) — whenever it was granted. Every
 * reader of a staff member's permissions goes through here: the API guard
 * below, the staff area's pages, the POS and media checks and the staff
 * lists, so a screen never offers what its route would refuse.
 *
 * A vendor's staff member with no vendor left holds nothing: an empty scope
 * reads as unscoped, which would open every seller's records to them.
 */
export function effectiveStaffPermissions(profile: {
  permissions?: unknown;
  managedBy?: unknown;
  vendorIds?: unknown[] | null;
}): StaffPermission[] {
  const granted = Array.isArray(profile.permissions)
    ? (profile.permissions as StaffPermission[])
    : [];
  if (!isVendorOwnedStaffProfile(profile)) return granted;
  if (!profile.vendorIds?.length) return [];
  const expanded = granted.flatMap((permission) => [
    permission,
    ...(VENDOR_STAFF_LEGACY_GRANT_PARTS[permission] ?? []),
  ]);
  return Array.from(new Set(expanded)).filter(
    (permission) => !VENDOR_STAFF_PLATFORM_ONLY_PERMISSIONS.includes(permission),
  );
}

/**
 * A vendor's own staff change an order only when all of it is their vendor's.
 * They can open an order that merely includes their vendor, but the order
 * screens write the whole order — its status, tracking number, address and
 * notes reach every seller's parcel — and the vendor itself only ever changes
 * its own consignment. Platform staff keep the order-level rule.
 */
export function assertVendorStaffMayChangeOrder(
  access: { vendorOwned?: boolean; staffScope?: StaffAccessScope },
  order: Parameters<typeof isOrderEntirelyInScope>[0],
): void {
  if (access.vendorOwned && !isOrderEntirelyInScope(order, access.staffScope)) {
    throw new AuthorizationError(
      "This order includes other sellers' items, so only the store can change it.",
    );
  }
}

/**
 * `assertVendorStaffMayChangeOrder` for a route that has not loaded the order
 * itself. Reads only the vendor fields, and only for a vendor's staff; an
 * order they cannot see is left to the route's own lookup to 404.
 */
export async function assertVendorStaffMayChangeOrderById(
  access: { vendorOwned?: boolean; staffScope?: StaffAccessScope },
  orderId: string,
): Promise<void> {
  if (!access.vendorOwned) return;
  const order = await Order.findOne(
    mergeScopeFilter({ _id: orderId }, buildStaffOrderScopeFilter(access.staffScope)),
  )
    .select("items.vendorId subOrders.vendorId")
    .lean<{
      items?: Array<{ vendorId?: unknown }>;
      subOrders?: Array<{ vendorId?: unknown }>;
    } | null>();
  if (order) assertVendorStaffMayChangeOrder(access, order);
}

/**
 * A vendor's grant for its own staff, as it may be stored: known permissions a
 * vendor can grant, each once. Anything else — a platform-only permission, a
 * made-up string — is dropped rather than refused, so a save from a screen
 * opened before the list existed still goes through.
 */
export function sanitizeVendorStaffPermissions(input: unknown): StaffPermission[] {
  if (!Array.isArray(input)) return [];
  const valid = input.filter(
    (permission: unknown): permission is StaffPermission =>
      typeof permission === "string" &&
      VENDOR_STAFF_PERMISSIONS.includes(permission as StaffPermission),
  );
  return Array.from(new Set(valid));
}

export async function getActiveStaffAccess(userId: string): Promise<{
  permissions: StaffPermission[];
  scope: StaffAccessScope;
  /** A vendor created this staff member — see `effectiveStaffPermissions`. */
  vendorOwned: boolean;
  /**
   * An active account with an active staff profile. False is a staff member
   * whose access was switched off (or never set up): no permissions, and no
   * scope to read as "unscoped" either.
   */
  active: boolean;
}> {
  await connectDB();
  const [profile, user] = await Promise.all([
    StaffProfile.findOne({ userId, isActive: true })
      .select("permissions managedBy vendorIds locationIds fulfillmentRegions")
      .lean(),
    User.findById(userId).select("status").lean(),
  ]);
  const status = (user as { status?: string } | null)?.status;
  if (
    status &&
    status !== USER_ACCOUNT_STATUS.ACTIVE
  ) {
    return { permissions: [], scope: EMPTY_STAFF_SCOPE, vendorOwned: false, active: false };
  }
  const staffProfile =
    profile as {
      permissions?: unknown;
      managedBy?: unknown;
      vendorIds?: unknown[];
      locationIds?: unknown[];
      fulfillmentRegions?: unknown[];
    } | null;
  return {
    active: Boolean(staffProfile),
    permissions: staffProfile ? effectiveStaffPermissions(staffProfile) : [],
    vendorOwned: staffProfile ? isVendorOwnedStaffProfile(staffProfile) : false,
    scope: normalizeStaffScope({
      vendorIds: staffProfile?.vendorIds?.map(String),
      locationIds: staffProfile?.locationIds?.map(String),
      fulfillmentRegions: staffProfile?.fulfillmentRegions?.map(String),
      wholeOrdersOnly: staffProfile ? isVendorOwnedStaffProfile(staffProfile) : false,
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
  /** True for staff a vendor created; absent for admins. */
  vendorOwned?: boolean;
}> {
  if (session.user.role === USER_ROLES.ADMIN) return {};
  if (
    session.user.role !== USER_ROLES.STAFF &&
    session.user.role !== USER_ROLES.SELLER
  ) {
    throw new AuthorizationError();
  }

  const {
    permissions: staffPermissions,
    scope: staffScope,
    vendorOwned,
  } = await getActiveStaffAccess(session.user.id);
  if (!required?.length) return { staffPermissions, staffScope, vendorOwned };

  const ok =
    mode === "all"
      ? required.every((p) => staffPermissions.includes(p))
      : required.some((p) => staffPermissions.includes(p));

  if (!ok) throw new AuthorizationError();
  return { staffPermissions, staffScope, vendorOwned };
}

/**
 * Refuses staff limited to vendors, locations or regions, for surfaces that
 * cannot be narrowed to a scope: store-wide traffic, shared catalogue data
 * such as global variants. Admins and unscoped staff pass (no scope object, or
 * an empty one).
 */
export function assertUnscopedStaff(
  scope: StaffAccessScope | null | undefined,
  message: string,
): void {
  if (hasStaffScope(scope)) throw new AuthorizationError(message);
}
