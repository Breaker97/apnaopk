import { Types } from "mongoose";

export interface StaffAccessScope {
  vendorIds: string[];
  locationIds: string[];
  fulfillmentRegions: string[];
  /**
   * Set for a vendor's own staff: an order is in their scope only when all of
   * it is their vendor's. Other sellers' lines are not theirs to see, so an
   * order that carries any stays out of their staff area altogether — the
   * vendor works it from its own orders page, consignment by consignment.
   * Platform staff scoped to a vendor keep seeing every order that includes
   * one of theirs.
   */
  wholeOrdersOnly?: boolean;
}

export const EMPTY_STAFF_SCOPE: StaffAccessScope = {
  vendorIds: [],
  locationIds: [],
  fulfillmentRegions: [],
};

export function normalizeStaffScope(
  input?: Partial<StaffAccessScope> | null,
): StaffAccessScope {
  return {
    vendorIds: normalizeList(input?.vendorIds),
    locationIds: normalizeList(input?.locationIds),
    fulfillmentRegions: normalizeList(input?.fulfillmentRegions),
    ...(input?.wholeOrdersOnly ? { wholeOrdersOnly: true } : {}),
  };
}

export function hasStaffScope(scope?: StaffAccessScope | null) {
  if (!scope) return false;
  return (
    scope.vendorIds.length > 0 ||
    scope.locationIds.length > 0 ||
    scope.fulfillmentRegions.length > 0
  );
}

/**
 * Combine the per-dimension groups a scope produces.
 *
 * Within one dimension the alternatives are ORed — a vendor-scoped staff member
 * may match an order through either `items.vendorId` or `subOrders.vendorId`.
 * Across dimensions they are ANDed, because each assignment is a restriction,
 * not an extra key.
 *
 * That distinction became load-bearing when inventory locations gained an
 * owner: while every location belonged to the platform, ORing vendor and
 * location was merely generous. Now a location belongs to one merchant, so a
 * single OR would let a staff member assigned to Vendor A plus Location X read
 * *every* merchant's products that happen to hold stock at X.
 */
function combineScopeGroups(
  groups: Record<string, unknown>[][],
): Record<string, unknown> {
  const active = groups.filter((clauses) => clauses.length > 0);
  if (active.length === 0) return impossibleQuery();

  const anded = active.map((clauses) =>
    clauses.length === 1 ? clauses[0] : { $or: clauses },
  );

  return anded.length === 1 ? anded[0] : { $and: anded };
}

/**
 * Whether every part of an order — each sub-order and each line — belongs to
 * the scope's vendors: the in-memory form of what `buildStaffOrderScopeFilter`
 * asks of a `wholeOrdersOnly` scope. Nothing that names a vendor means
 * nothing proves it is theirs.
 */
export function isOrderEntirelyInScope(
  order: {
    subOrders?: Array<{ vendorId?: unknown } | null> | null;
    items?: Array<{ vendorId?: unknown } | null> | null;
  },
  scope?: StaffAccessScope | null,
): boolean {
  if (!hasStaffScope(scope)) return true;
  const vendors = new Set(scope!.vendorIds.map(String));
  if (vendors.size === 0) return false;
  const owners = [...(order.subOrders ?? []), ...(order.items ?? [])]
    .map((part) => part?.vendorId)
    .filter((vendorId) => vendorId != null)
    .map(String);
  return owners.length > 0 && owners.every((vendorId) => vendors.has(vendorId));
}

/**
 * The scope's vendors as the documents store them. The filters below also go
 * into aggregation `$match` stages, which Mongoose does not cast — a string
 * never equals an ObjectId there, so a vendor-scoped staff member's dashboard,
 * order stats and analytics counted nothing.
 */
function vendorObjectIds(scope: StaffAccessScope): Types.ObjectId[] {
  return scope.vendorIds
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
}

/**
 * The orders a staff member may see. For a `wholeOrdersOnly` scope, those with
 * no sub-order and no line naming another vendor (or none — `$nin` matches a
 * missing field, as `isOrderEntirelyInScope` refuses one).
 */
export function buildStaffOrderScopeFilter(
  scope?: StaffAccessScope | null,
): Record<string, unknown> {
  if (!hasStaffScope(scope)) return {};
  const visible = orderVisibilityFilter(scope!);
  if (!scope!.wholeOrdersOnly) return visible;

  const vendorIds = vendorObjectIds(scope!);
  if (vendorIds.length === 0) return impossibleQuery();
  const outside = { $elemMatch: { vendorId: { $nin: vendorIds } } };
  return {
    $and: [visible, { subOrders: { $not: outside } }, { items: { $not: outside } }],
  };
}

/** Orders that include one of the scope's vendors, locations or regions. */
function orderVisibilityFilter(scope: StaffAccessScope): Record<string, unknown> {
  const vendorClauses: Record<string, unknown>[] = [];
  if (scope.vendorIds.length > 0) {
    const vendorIds = vendorObjectIds(scope);
    vendorClauses.push(
      { "items.vendorId": { $in: vendorIds } },
      { "subOrders.vendorId": { $in: vendorIds } },
    );
  }

  const locationClauses: Record<string, unknown>[] = [];
  if (scope.locationIds.length > 0) {
    locationClauses.push({ posLocationId: { $in: scope.locationIds } });
  }

  const regionClauses: Record<string, unknown>[] = [];
  if (scope.fulfillmentRegions.length > 0) {
    regionClauses.push(
      { "shippingAddress.country": { $in: scope.fulfillmentRegions } },
      { "shippingAddress.state": { $in: scope.fulfillmentRegions } },
    );
  }

  return combineScopeGroups([vendorClauses, locationClauses, regionClauses]);
}

export function buildStaffProductScopeFilter(
  scope?: StaffAccessScope | null,
): Record<string, unknown> {
  if (!hasStaffScope(scope)) return {};

  const vendorClauses: Record<string, unknown>[] = [];
  if (scope!.vendorIds.length > 0) {
    vendorClauses.push({ vendorId: { $in: vendorObjectIds(scope!) } });
  }

  const locationClauses: Record<string, unknown>[] = [];
  if (scope!.locationIds.length > 0) {
    locationClauses.push(
      { "locationInventory.locationId": { $in: scope!.locationIds } },
      { "variants.locationInventory.locationId": { $in: scope!.locationIds } },
    );
  }

  return combineScopeGroups([vendorClauses, locationClauses]);
}

export function buildStaffLocationScopeFilter(
  scope?: StaffAccessScope | null,
): Record<string, unknown> {
  if (!scope?.locationIds.length) return {};
  return { _id: { $in: scope.locationIds } };
}

export function mergeScopeFilter(
  query: Record<string, unknown>,
  scopeFilter: Record<string, unknown>,
) {
  if (Object.keys(scopeFilter).length === 0) return query;
  if (Object.keys(query).length === 0) return scopeFilter;
  return { $and: [query, scopeFilter] };
}

function normalizeList(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function impossibleQuery() {
  return { _id: { $exists: false } };
}
