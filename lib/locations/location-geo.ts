import "server-only";

/**
 * Where a collection point actually is.
 *
 * "Near me" has to be measured from the place a shopper would walk into. It was
 * measured from `Vendor.address.geo` — the address collected for payouts and
 * KYC, which `lib/vendor-address.ts` is explicit is not for publication. That
 * address is routinely an accountant's office or a home in another city, so the
 * distances were confidently wrong about places nobody could visit. No
 * comparable platform does this: Walmart and Target geocode stores, Shopify
 * geocodes Locations, eBay geocodes the listing's collection postcode. The
 * geocoded entity is always where the goods change hands.
 *
 * Getting a point onto every branch without asking merchants to do data entry
 * is the practical problem, so there are two ways in, cheapest first: a map
 * link the merchant pasted (`lib/locations/maps-url.ts`), else the vendor's own
 * geocoded address.
 */

import { Vendor } from "@/models";
import { InventoryLocation } from "@/models/inventory-location.model";
import { vendorGeoPoint, type VendorGeoPoint } from "@/lib/locations/vendor-geo";

// Re-exported so server callers have one import for "where is this branch",
// while the parser itself stays client-safe for the location form.
export { coordinatesFromMapsUrl } from "@/lib/locations/maps-url";

/**
 * The point a branch should carry when it has not been given one.
 *
 * Inherited from the vendor's own geocoded address, which is the closest thing
 * to the truth available for free: for the overwhelming majority of merchants —
 * one shop, one address — it IS the branch. A merchant whose counter is
 * somewhere else overrides it, and only they can know that.
 *
 * This is what keeps the feature working on a fresh install with zero data
 * entry. Demanding a hand-placed pin per branch would mean most stores had no
 * collectable branches at all, and a filter that finds nothing is worse than no
 * filter.
 */
export async function inheritedVendorGeo(
  vendorId: string,
): Promise<VendorGeoPoint | undefined> {
  const vendor = await Vendor.findById(vendorId)
    .select("address.coordinates address.geo")
    .lean<{
      address?: {
        coordinates?: { lat?: number; lng?: number } | null;
        geo?: unknown;
      };
    } | null>();

  // Rebuilt through `vendorGeoPoint` rather than copied from `address.geo`, so
  // the [lng, lat] axis order is applied in exactly one place. A swap here does
  // not throw — it silently moves the branch to the wrong hemisphere, where it
  // simply stops appearing in radius searches.
  return vendorGeoPoint(vendor?.address);
}

/**
 * Move every inheriting branch when the vendor's own address moves.
 *
 * Inheritance is resolved once, at write time, so without this a merchant who
 * relocates keeps being found at their old address forever — and nothing in
 * either UI would hint at why. Branches with their own pasted pin are left
 * alone: the merchant already said the counter is somewhere else.
 *
 * Called after the vendor save rather than inside it, and never allowed to fail
 * it: a store's own settings must save whether or not their branches follow.
 */
export async function syncInheritedLocationGeo(
  vendorId: unknown,
  geo: VendorGeoPoint | undefined,
): Promise<void> {
  // "No pasted link" is the definition of inheriting. Both shapes count: a
  // branch created before the field existed has no `mapsUrl` at all, and one
  // whose merchant cleared the field has an empty string.
  const inheriting = {
    vendorId,
    $or: [{ mapsUrl: { $exists: false } }, { mapsUrl: "" }],
  };

  try {
    await InventoryLocation.updateMany(
      inheriting,
      // An address that stopped resolving unsets the point instead of keeping
      // the old one. A branch found at a place the merchant has left is worse
      // than one found only by city.
      geo ? { $set: { geo } } : { $unset: { geo: "" } },
    );
  } catch (error) {
    console.error("Failed to sync inherited location geo:", error);
  }
}
