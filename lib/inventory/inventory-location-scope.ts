import "server-only";

/**
 * Who a caller is acting as when they touch inventory locations.
 *
 * Locations belong to a vendor, but four different kinds of caller reach them —
 * an admin, a marketplace vendor, platform staff, and the POS register — and
 * each derives its owner differently. Resolving that in one place is what keeps
 * a read path and its matching write path from disagreeing about who owns what,
 * which is the failure mode that leaks one merchant's warehouses to another.
 *
 * Everything that queries `InventoryLocation`, or that accepts a `locationId`
 * from a client, must go through this module. There is deliberately no second
 * mechanism.
 */

import { USER_ROLES } from "@/config/app.config";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { connectDB } from "@/lib/db";
import {
  storeProfileErrorCode,
  type StoreProfileProblem,
} from "@/lib/inventory/store-profile";
import {
  ensureDefaultVendorId,
  type DefaultVendorProblem,
} from "@/lib/vendors/multi-vendor";
import { isAdmin, isVendor } from "@/lib/access/rbac";
import { getActiveStaffAccess } from "@/lib/access/staff-authz";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { InventoryLocation } from "@/models/inventory-location.model";

type ScopeUser = {
  id: string;
  role?: string | null;
  roles?: (string | null | undefined)[] | null;
};

export type InventoryLocationScope = {
  /**
   * The owner stamped on anything this caller creates, and the vendor whose
   * locations they see by default.
   */
  vendorId: string;
  /**
   * Every owner this caller may read. Usually `[vendorId]`; platform staff
   * scoped to several vendors get all of them.
   */
  readVendorIds: string[];
  /** True when the caller is the merchant, false for admin/staff acting as one. */
  isVendor: boolean;
  /**
   * Staff restriction to specific location ids. Empty means "no restriction
   * beyond the vendor". Never widens — it only narrows within `readVendorIds`.
   */
  locationIds: string[];
};

/**
 * Resolve the acting vendor.
 *
 * `mode` only affects vendors: a vendor still completing subscription setup may
 * read their locations (the product form needs the list to render) but may not
 * create or edit one.
 */
export async function resolveLocationScope(
  user: ScopeUser,
  mode: "read" | "write" = "read",
): Promise<InventoryLocationScope> {
  await connectDB();

  // Role checks go through the rbac helpers, never a bare `user.role`: an
  // account can carry `roles: ["admin"]` with a stale singular `role`, and the
  // two must not resolve to different owners. The cast only widens `role` from
  // the session's plain string to the role union the helpers compare against.
  const roleUser = user as Parameters<typeof isAdmin>[0];

  if (isVendor(roleUser) && !isAdmin(roleUser)) {
    const vendor = await requireApprovedVendorByUserId(user.id, {
      allowPaymentRequiredSetup: mode === "read",
    });
    const vendorId = String(vendor._id);
    return {
      vendorId,
      readVendorIds: [vendorId],
      isVendor: true,
      locationIds: [],
    };
  }

  if (isAdmin(roleUser)) {
    return houseScope([], user.id);
  }

  if (
    user.role === USER_ROLES.STAFF ||
    user.role === USER_ROLES.SELLER ||
    user.roles?.includes(USER_ROLES.STAFF) ||
    user.roles?.includes(USER_ROLES.SELLER)
  ) {
    const { scope } = await getActiveStaffAccess(user.id);

    // Staff assigned to exactly one vendor act as that vendor. Assigned to
    // several, they may read all of them but create only under the house
    // vendor — there is no way to guess which of several they meant.
    if (scope.vendorIds.length === 1) {
      return {
        vendorId: scope.vendorIds[0],
        readVendorIds: scope.vendorIds,
        isVendor: false,
        locationIds: scope.locationIds,
      };
    }

    const house = await houseScope(scope.locationIds, user.id);
    return scope.vendorIds.length > 1
      ? {
          ...house,
          readVendorIds: Array.from(
            new Set([house.vendorId, ...scope.vendorIds]),
          ),
        }
      : house;
  }

  throw new AuthorizationError("You do not have permission to manage locations");
}

async function houseScope(
  locationIds: string[],
  preferredOwnerId: string,
): Promise<InventoryLocationScope> {
  // Made on first need: a 2.4.0 store installed without demo data has no house
  // profile, and every admin screen built on locations stopped at a 404 until
  // someone thought to save Settings → General. When it is there this is the
  // same single read as before; it writes only to make what is missing.
  const house = await ensureDefaultVendorId({ preferredOwnerId });
  if (!house.vendorId) throw storeProfileUnavailable(house.problem);

  const vendorId = house.vendorId;
  return { vendorId, readVendorIds: [vendorId], isVendor: false, locationIds };
}

/**
 * The 404 for a store whose house profile is missing and could not be made,
 * with a code the client can act on (`STORE_PROFILE_NO_OWNER` …) instead of
 * matching the English message. The message stays what API callers know.
 */
export function storeProfileUnavailable(
  problem: DefaultVendorProblem | StoreProfileProblem = "missing",
): NotFoundError {
  const error = new NotFoundError("Default store profile");
  error.code = storeProfileErrorCode(problem === "error" ? "missing" : problem);
  return error;
}

/**
 * The scope for a caller already known to be acting as one specific vendor.
 *
 * For paths that resolved and authorised the vendor themselves and just need
 * the location filter — the vendor inventory list, the vendor dashboard tiles —
 * rather than re-deriving the owner from the session.
 */
export function vendorLocationScope(vendorId: string): InventoryLocationScope {
  return {
    vendorId,
    readVendorIds: [vendorId],
    isVendor: true,
    locationIds: [],
  };
}

/**
 * Where a product's stock may be recorded: at its OWNER's locations, narrowed to
 * a staff member's assigned ones when they have any.
 *
 * Never the editor's own scope. An admin editing a vendor's product, or a staff
 * member assigned to several vendors, acts under one store's locations while
 * the product belongs to another. Judged by the editor, every save stripped the
 * owner's rows from the payload, and the stock merge then read the missing rows
 * as removed and deleted the vendor's stock.
 */
export function productStockScope(
  ownerVendorId: string,
  staffLocationIds: readonly string[] = [],
): InventoryLocationScope {
  return {
    vendorId: ownerVendorId,
    readVendorIds: [ownerVendorId],
    isVendor: false,
    locationIds: [...staffLocationIds],
  };
}

/**
 * The vendor a product created in the admin editor belongs to, or `null` for
 * the house store. Staff scoped to vendors create under the first of them: the
 * product has to land inside their scope, or they could not open what they
 * just made. The create route and the editor's locations both ask this, so the
 * shelves offered are the owner's.
 */
export function adminProductCreateVendorId(
  staffScope?: { vendorIds: string[] } | null,
): string | null {
  return staffScope?.vendorIds[0] ?? null;
}

/**
 * The `InventoryLocation` filter for a scope.
 *
 * Rows written before locations had an owner match everyone: failing open is
 * what lets the app run normally in the window between deploying this code and
 * running `scripts/backfill-location-vendor.ts`. Once every row is backfilled
 * the `$exists` arm simply never matches, and it can be dropped.
 */
export function locationOwnerFilter(
  scope: InventoryLocationScope,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const owners: Record<string, unknown>[] = [
    { vendorId: { $in: scope.readVendorIds } },
    { vendorId: { $exists: false } },
    { vendorId: null },
  ];

  const filter: Record<string, unknown> = { ...extra, $or: owners };

  if (scope.locationIds.length > 0) {
    // Staff restriction ANDs with ownership; it must never widen it.
    filter._id = { $in: scope.locationIds };
  }

  return filter;
}

/**
 * The subset of `locationIds` this caller may actually write to, as a Set.
 *
 * Used by the product write path to drop `locationInventory` rows pointing at
 * someone else's location: the field is a bare string with no `ref`, so nothing
 * else stops a crafted payload from parking stock in another merchant's shop.
 */
export async function allowedLocationIds(
  scope: InventoryLocationScope,
): Promise<Set<string>> {
  const rows = await InventoryLocation.find(locationOwnerFilter(scope))
    .select("_id")
    .lean<Array<{ _id: unknown }>>();

  return new Set(rows.map((row) => String(row._id)));
}
