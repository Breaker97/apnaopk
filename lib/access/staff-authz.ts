import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, StaffProfile, User, Vendor } from "@/models";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import {
  VENDOR_STAFF_LEGACY_GRANT_PARTS,
  VENDOR_STAFF_PERMISSIONS,
  VENDOR_STAFF_PLATFORM_ONLY_PERMISSIONS,
  resolveRetiredStaffPermissions,
  type StaffPermission,
} from "@/config/permissions.config";
import { AuthorizationError } from "@/lib/api/errors";
import { SELLER_PERMISSION_FOR_STAFF } from "@/config/permissions.config";
import {
  VENDOR_ACCESS_FIELDS,
  loadVendorAccess,
  type VendorAccessSubject,
} from "@/lib/vendors/vendor-permissions";
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
import { staffResourcePermissions, type StaffResource } from "@/lib/access/staff-resource-actions";

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
    ? resolveRetiredStaffPermissions(profile.permissions as StaffPermission[])
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
  const valid = resolveRetiredStaffPermissions(input).filter(
    (permission: unknown): permission is StaffPermission =>
      typeof permission === "string" &&
      VENDOR_STAFF_PERMISSIONS.includes(permission as StaffPermission),
  );
  return Array.from(new Set(valid));
}

/**
 * What a seller's plan lets its own staff hold: a staff permission only while
 * the seller holds what it stands on (config SELLER_PERMISSION_FOR_STAFF),
 * with the seller's plan, overrides and the store's policy for sellers — but
 * not its shop's state: a closed shop's staff keep what the web always let
 * them (the business app refuses them on its own). Nothing for a seller who
 * is gone or an id that is not one.
 */
export async function sellerStaffAllowance(vendorId: unknown): Promise<(permission: string) => boolean> {
  const id = String(vendorId ?? "");
  if (!Types.ObjectId.isValid(id)) return () => false;
  await connectDB();
  const vendor = await Vendor.findById(id).select(VENDOR_ACCESS_FIELDS).lean<VendorAccessSubject | null>();
  if (!vendor) return () => false;
  const access = await loadVendorAccess(vendor, { accessMode: "approved" });
  if (!access) return () => false;
  return (permission) => {
    const needs = SELLER_PERMISSION_FOR_STAFF[permission as StaffPermission];
    return Boolean(needs && access.has(needs));
  };
}

/**
 * What a seller holds by its plan, the store's policy for sellers and its
 * overrides (its shop's state aside), for the seller's staff screens: they
 * offer only what `sellerStaffAllowance` lets its staff hold.
 */
export async function sellerPlanPermissions(vendorId: unknown): Promise<string[]> {
  const id = String(vendorId ?? "");
  if (!Types.ObjectId.isValid(id)) return [];
  await connectDB();
  const vendor = await Vendor.findById(id).select(VENDOR_ACCESS_FIELDS).lean<VendorAccessSubject | null>();
  if (!vendor) return [];
  const access = await loadVendorAccess(vendor, { accessMode: "approved" });
  return access ? Array.from(access.effective) : [];
}

/**
 * A staff member's permissions, held to their seller's plan when a seller
 * owns them (`sellerStaffAllowance`): one who works for several sellers holds
 * only what every one of their plans gives. The platform's own staff hold
 * what they were given.
 */
export async function sellerCappedStaffPermissions(profile: {
  permissions?: unknown;
  managedBy?: unknown;
  vendorIds?: unknown[] | null;
}): Promise<StaffPermission[]> {
  const granted = effectiveStaffPermissions(profile);
  if (!isVendorOwnedStaffProfile(profile) || granted.length === 0) return granted;
  const allowances = await Promise.all((profile.vendorIds ?? []).map((vendorId) => sellerStaffAllowance(vendorId)));
  return granted.filter((permission) => allowances.every((allows) => allows(permission)));
}

/**
 * Refuses a save that gives a seller's staff member something the seller's
 * plan does not include. What they already hold is not given again: a seller
 * whose plan shrank still saves the member's name (and what they hold beyond
 * the plan stays unusable, `sellerCappedStaffPermissions`).
 */
export async function assertSellerMayGiveStaff(
  vendorId: unknown,
  permissions: readonly string[],
  held: readonly string[] = [],
): Promise<void> {
  const already = new Set(held);
  const added = permissions.filter((permission) => !already.has(permission));
  if (added.length === 0) return;
  const allows = await sellerStaffAllowance(vendorId);
  const beyond = added.filter((permission) => !allows(permission));
  if (beyond.length > 0) {
    throw new AuthorizationError(`Your plan does not include: ${beyond.join(", ")}.`);
  }
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
    permissions: staffProfile ? await sellerCappedStaffPermissions(staffProfile) : [],
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

/** Public catalog endpoints expose management records only to granted, active staff. */
export async function canReadCatalogManagement(
  user: { id?: string; role?: string | null; roles?: string[] | null } | null | undefined,
  resource: Extract<StaffResource, "categories" | "brands">,
): Promise<boolean> {
  if (user?.role === USER_ROLES.ADMIN || user?.roles?.includes(USER_ROLES.ADMIN)) return true;
  if (!user?.id || (user.role !== USER_ROLES.STAFF && user.role !== USER_ROLES.SELLER)) return false;
  const access = await getActiveStaffAccess(user.id);
  return access.active && staffResourcePermissions(resource).some((permission) => access.permissions.includes(permission));
}
