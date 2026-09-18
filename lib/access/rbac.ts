/**
 * RBAC (Role-Based Access Control) Utilities
 * Provides functions and middleware for permission checking
 */

import { USER_ROLES, type UserRole } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import {
  VENDOR_PERMISSIONS,
  STAFF_PERMISSIONS,
  type VendorPermission,
  type StaffPermission,
} from "@/config/permissions.config";
import { StaffProfile, type IStaffProfile } from "@/models/staff-profile.model";
import { AuthorizationError } from "@/lib/api/errors";

// ============================================
// Role Checking Utilities
// ============================================

/**
 * The slice of a user every role check needs. `role`/`roles` are plain strings
 * on purpose: a better-auth session user carries `role?: string`, and typing
 * the field as the `UserRole` union made every route cast `session.user`
 * through `unknown` to `IUser` just to call `isAdmin()`.
 */
export type MinimalUser =
  | { id?: string; role?: string; roles?: string[] }
  | null
  | undefined;

/**
 * Check if user has a specific role
 */
function hasRole(
  user: MinimalUser,
  role: UserRole,
): boolean {
  if (!user) return false;
  // Check both legacy 'role' field and new 'roles' array
  return user.roles?.includes(role) || user.role === role;
}

/**
 * Check if user is an admin
 */
export function isAdmin(user: MinimalUser): boolean {
  return hasRole(user, USER_ROLES.ADMIN);
}

/**
 * Check if user is a vendor
 */
export function isVendor(user: MinimalUser): boolean {
  return hasRole(user, USER_ROLES.VENDOR);
}

// ============================================
// Permission Checking Utilities
// ============================================

// ============================================
// Route Guard Helpers (for API routes)
// ============================================

// ============================================
// Vendor Permission Checking
// ============================================

/**
 * Check if user is a seller (staff role for POS)
 */
export function isSeller(user: MinimalUser): boolean {
  return isStaffRole(user?.role) || hasRole(user, USER_ROLES.SELLER);
}

/**
 * May this caller delete store media by storage key?
 *
 * Deletion takes an arbitrary key rather than a record the caller owns, so
 * holding *some* non-customer role is not enough — a staff account with an
 * empty permission list would otherwise be able to empty the bucket. Admins
 * qualify outright; vendors and staff need a product-management grant.
 */
export async function canManageStoreMedia(
  user: MinimalUser & { id?: string },
): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user)) return true;

  if (isVendor(user)) {
    return (
      (await hasVendorPermission(user, VENDOR_PERMISSIONS.MANAGE_PRODUCTS)) ||
      (await hasVendorPermission(user, VENDOR_PERMISSIONS.EDIT_PRODUCTS))
    );
  }

  if (isSeller(user) && user.id) {
    return hasAnyStaffPermission(user.id, [
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
      STAFF_PERMISSIONS.EDIT_PRODUCTS,
    ]);
  }

  return false;
}

/**
 * May this caller move money back to a shopper?
 *
 * The answer is who the merchant of record is, not who holds a grant. Storify
 * collects on the platform's OWN gateway credentials — `lib/order-refund.ts`
 * reads `settings.payment.*` and never a vendor's — so a refund a vendor issues
 * spends the platform's money, and a refund they merely RECORD (`manual: true`)
 * flips an order to `refunded` while no money moves at all. Neither is theirs to
 * decide.
 *
 * This is the single enforcement point for `ADMIN_PERMISSIONS.MANAGE_REFUNDS`,
 * and it is deliberately narrower than a permission check: the capability is
 * scoped to the admin ROLE, so no vendor grant, staff grant or per-admin
 * permission list can widen or narrow it. Everything else in the return
 * workflow — approve, reject, receive, inspect, restock — stays with whoever
 * owns the items.
 *
 * Synchronous and role-only on purpose. Every refund path calls it before
 * touching a gateway, and a guard that can fail open on a database read is not
 * a guard.
 */
export function canIssueRefunds(
  // Widened past `MinimalUser` so a route can hand its session straight in:
  // the auth session types `role` as a bare string. The cast is safe because
  // `hasRole` compares strings, and going through `isAdmin` rather than
  // re-testing the role here keeps one implementation of what "admin" means.
  user: { role?: string | null; roles?: readonly string[] | null } | null | undefined,
): boolean {
  return isAdmin(user as MinimalUser);
}

/**
 * Check if a vendor holds a permission.
 *
 * Thin by design: the four layers, the implication table and the policy mapping
 * all live in `lib/vendor-permissions.ts`, so this and the admin Access tab
 * cannot drift apart the way the two hand-kept alias maps did.
 *
 * Admins bypass it entirely.
 */
export async function hasVendorPermission(
  user: MinimalUser,
  permission: VendorPermission,
): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (!isVendor(user) || !user.id) return false;

  const { loadVendorAccess } = await import("@/lib/vendors/vendor-permissions");
  const access = await loadVendorAccess(user.id);
  return access ? access.has(permission) : false;
}

/**
 * Throw unless `user` is an admin or holds `permission`.
 *
 * The five-line "hasVendorPermission … if (!ok && !isAdmin) throw" block was
 * copied into ~30 vendor routes; this is that block. `message` is the route's
 * own wording ("You do not have permission to edit orders") so the response a
 * vendor sees is unchanged.
 */
export async function assertVendorPermission(
  user: MinimalUser,
  permission: VendorPermission,
  message: string,
): Promise<void> {
  if (await hasVendorPermission(user, permission)) return;
  if (isAdmin(user)) return;
  throw new AuthorizationError(message);
}

/**
 * Check if user can access POS (based on role and settings)
 */
export async function canAccessPOS(
  user: MinimalUser,
): Promise<boolean> {
  if (!user) return false;

  try {
    const { getSettings } = await import("@/models/settings.model");
    const settings = await getSettings();

    if (!settings.pos?.enabled) return false;

    if (isAdmin(user) && settings.pos.allowAdminSales) return true;
    if (isVendor(user) && settings.pos.allowVendorSales) return true;
    if (isSeller(user) && settings.pos.allowSellerSales) {
      if (!user.id) return false;
      const profile = await getStaffProfile(user.id);
      if (!profile?.isActive) return false;
      return profile.permissions.includes(STAFF_PERMISSIONS.ACCESS_POS);
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Whether this till seat may give a discount — on a line or on the sale.
 *
 * Every POS seat could take any line or the whole sale to 100% off, with no
 * reason required, which is the till's version of handing stock away. A
 * discount is a pricing decision, so it belongs to the people who own the
 * price: an admin, the vendor whose goods they are, and staff trusted to
 * manage the POS. A seat that can only ring up sales rings them up at price.
 */
export async function canApplyPosDiscount(user: MinimalUser): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user) || isVendor(user)) return true;
  if (isSeller(user) && user.id) {
    const profile = await getStaffProfile(user.id);
    return Boolean(
      profile?.isActive &&
        profile.permissions.includes(STAFF_PERMISSIONS.MANAGE_POS),
    );
  }
  return false;
}

// ============================================
// Staff Permission Checking
// ============================================

/**
 * Get staff profile with permissions
 */
async function getStaffProfile(
  userId: string,
): Promise<IStaffProfile | null> {
  try {
    const profile = await StaffProfile.findOne({ userId });
    return profile;
  } catch {
    return null;
  }
}

/**
 * Check if staff user has any of the specified permissions
 */
async function hasAnyStaffPermission(
  userId: string,
  permissions: StaffPermission[],
): Promise<boolean> {
  const profile = await getStaffProfile(userId);
  if (!profile || !profile.isActive) return false;
  return permissions.some((p) => profile.permissions.includes(p));
}
