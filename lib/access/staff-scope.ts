export interface StaffAccessScope {
  vendorIds: string[];
  locationIds: string[];
  fulfillmentRegions: string[];
}

export const EMPTY_STAFF_SCOPE: StaffAccessScope = {
  vendorIds: [],
  locationIds: [],
  fulfillmentRegions: [],
};

export function normalizeStaffScope(input?: Partial<StaffAccessScope> | null) {
  return {
    vendorIds: normalizeList(input?.vendorIds),
    locationIds: normalizeList(input?.locationIds),
    fulfillmentRegions: normalizeList(input?.fulfillmentRegions),
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

export function buildStaffOrderScopeFilter(
  scope?: StaffAccessScope | null,
): Record<string, unknown> {
  if (!hasStaffScope(scope)) return {};

  const vendorClauses: Record<string, unknown>[] = [];
  if (scope!.vendorIds.length > 0) {
    vendorClauses.push(
      { "items.vendorId": { $in: scope!.vendorIds } },
      { "subOrders.vendorId": { $in: scope!.vendorIds } },
    );
  }

  const locationClauses: Record<string, unknown>[] = [];
  if (scope!.locationIds.length > 0) {
    locationClauses.push({ posLocationId: { $in: scope!.locationIds } });
  }

  const regionClauses: Record<string, unknown>[] = [];
  if (scope!.fulfillmentRegions.length > 0) {
    regionClauses.push(
      { "shippingAddress.country": { $in: scope!.fulfillmentRegions } },
      { "shippingAddress.state": { $in: scope!.fulfillmentRegions } },
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
    vendorClauses.push({ vendorId: { $in: scope!.vendorIds } });
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
