/**
 * Label a product card with how far away it can be collected, and make sure no
 * raw coordinate survives into the response.
 *
 * The distance is **not** computed here. It comes from `findNearbyVendors`,
 * already measured from the merchant's nearest collection point — the place a
 * shopper would walk into. Measuring it here instead, from the vendor's own
 * `address.geo`, is what this module used to do and it was wrong: that address
 * is collected for payouts and KYC, and is routinely an accountant's office or
 * a home in another city. A grid could then filter to 5 km on a branch two
 * streets away and print "48 km" on the very same card.
 *
 * What stays here is the privacy boundary. `lib/vendor-address.ts` is explicit
 * that the address exists for payouts rather than for publication: the default
 * `city_country` precision is chosen so a vendor trading from home is legible
 * as a business *without exposing a doorstep*, and a `[lng, lat]` pair at seven
 * decimal places is a doorstep. So any point that rode along on a populated
 * vendor is consumed here and never survives into the returned object. Every
 * listing that renders distance goes through this function — that is the whole
 * reason it exists as one small module rather than inline in the grid.
 */

import {
  VENDOR_ADDRESS_DISPLAY,
  resolveVendorStoreVisibility,
} from "@/lib/vendors/vendor-address";

/**
 * The vendor ids an existing `vendorId` constraint already permits, as hex
 * strings, or `null` when there is no constraint to honour.
 *
 * Every location filter intersects against this rather than assigning over it:
 * by the time location runs, `vendorId` has already been pinned to the approved
 * vendor set by the storefront visibility rule, and a vendor page narrows it
 * further to one id. Overwriting would republish suspended vendors' products to
 * anyone who set a location.
 *
 * Handles both shapes the query builders produce: a bare id and `{ $in: [...] }`.
 * Values arrive as ObjectIds or hex strings depending on which built them, so
 * every id is stringified before comparison — an ObjectId and its hex string
 * are not `===` equal, and treating them as distinct silently empties the grid.
 */
function allowedVendorIds(constraint: unknown): Set<string> | null {
  if (!constraint) return null;

  if (typeof constraint === "object" && "$in" in constraint) {
    const values = (constraint as { $in?: unknown }).$in;
    if (!Array.isArray(values)) return null;
    return new Set(values.map((value) => String(value)));
  }

  return new Set([String(constraint)]);
}

/**
 * Keep a location result inside the vendor constraint already assembled by a
 * listing query.  Location must narrow visibility â€” never replace it.
 */
export function intersectLocationVendorIds(
  constraint: unknown,
  nearbyVendorIds: string[],
): string[] {
  const allowed = allowedVendorIds(constraint);
  return allowed
    ? nearbyVendorIds.filter((id) => allowed.has(id))
    : nearbyVendorIds;
}

/** The vendor shape a populated product card carries. */
type PopulatedVendor = {
  _id?: unknown;
  address?: {
    city?: string;
    /** Present only until this module strips it. Never reaches the client. */
    geo?: unknown;
  };
  storeVisibility?: unknown;
} & Record<string, unknown>;

type ProductWithVendor = {
  vendorId?: PopulatedVendor | null;
  /** Only `false` disqualifies; absent means physical, as the model defaults. */
  shipping?: { isPhysicalProduct?: unknown } | null;
} & Record<string, unknown>;

/**
 * Distance to each vendor's nearest collection point, keyed by vendor id.
 *
 * Built from `findNearbyVendors`, which omits the entry entirely for a vendor
 * matched only by city name — there is no point to measure from, and inventing
 * a distance from a city centroid would put a number on a card that no branch
 * supports.
 */
export type VendorDistanceMap = Map<string, number>;

/**
 * Vendor ids reached through a real collection point rather than a city name.
 *
 * Built from `findNearbyVendors` matches whose `via` is `"radius"` — by
 * construction those are the merchants with an active, pickup-enabled branch
 * inside the shopper's radius. A city match proves nothing of the sort.
 */
export type CollectNearbySet = Set<string>;

/**
 * Attach `distanceKm` from the resolver's answer plus `collectNearby`, and
 * remove `address.geo` in every case — including when no distance is known,
 * since an unmeasured card must not leak what a measured one hides.
 */
export function withVendorDistance<T extends ProductWithVendor>(
  product: T,
  distances: VendorDistanceMap | null,
  collectNearby: CollectNearbySet | null = null,
): T & { distanceKm?: number; collectNearby?: boolean } {
  const vendor = product.vendorId;

  // No vendor populated at all: nothing to strip, nothing to label.
  if (!vendor || typeof vendor !== "object") return product;

  // A second gate on the same rule the resolver already applies. Duplicated
  // deliberately: this is the only function every listing passes through, so a
  // hidden vendor's distance cannot escape through some future caller that
  // assembles the map differently.
  const permitsDistance =
    resolveVendorStoreVisibility(vendor.storeVisibility).addressDisplay !==
    VENDOR_ADDRESS_DISPLAY.HIDDEN;
  const measured = permitsDistance
    ? distances?.get(String(vendor._id ?? ""))
    : undefined;

  // Rebuilt rather than mutated: `product` comes from a cached query result, and
  // deleting a field in place would strip it from the cache entry too, so a
  // later request served from cache would silently lose the distance.
  const { geo: _geo, ...safeAddress } = vendor.address ?? {};

  const safeProduct = {
    ...product,
    vendorId: {
      ...vendor,
      // Only re-attached when there was an address to begin with, so a vendor
      // without one does not gain an empty object.
      ...(vendor.address ? { address: safeAddress } : {}),
    },
  } as T & { distanceKm?: number; collectNearby?: boolean };

  if (measured !== undefined) {
    safeProduct.distanceKm = measured;
  }

  // Not gated on `permitsDistance`: hiding an address hides *where the seller
  // is*, not *that collection exists*. But a digital product is never
  // collectable no matter how close its seller's counter is, so the badge must
  // never appear on one — the storefront would be promising something checkout
  // answers `digital_only` to.
  if (
    collectNearby?.has(String(vendor._id ?? "")) &&
    product.shipping?.isPhysicalProduct !== false
  ) {
    safeProduct.collectNearby = true;
  }

  return safeProduct;
}
