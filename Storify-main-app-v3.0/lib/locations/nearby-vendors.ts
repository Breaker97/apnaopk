/**
 * Resolve a shopper's location to the vendors whose products they should see.
 *
 * Products carry no location of their own — a product is where its vendor is —
 * so every location-filtered product query runs in two steps: resolve the
 * location to vendor ids here, then constrain `Product.vendorId` to them.
 *
 * Two ways in, because branch data is uneven:
 *
 * - **radius** — `$near` over a collection point's `geo`. Exact, ordered
 *   nearest-first, and what the picker's distance slider drives. It measures
 *   from the place a shopper would walk into, NOT from the vendor's registered
 *   address: that one exists for payouts and KYC, and is routinely an office or
 *   a home in another city.
 * - **city name** — for merchants none of whose branches are geocoded. Without
 *   it they would be unreachable through the filter no matter how wide the
 *   radius, which silently hides part of the catalogue.
 *
 * Both are constrained to approved, live stores. Public address visibility
 * never changes where a vendor's products are eligible to appear.
 */

import { VENDOR_STATUS } from "@/config/app.config";
import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { VENDOR_ADDRESS_DISPLAY } from "@/lib/vendors/vendor-address";
import { Vendor } from "@/models";
import { InventoryLocation } from "@/models/inventory-location.model";
import {
  type LatLng,
  distanceKm,
  latLngFromGeoPoint,
} from "@/lib/locations/vendor-geo";

/**
 * A vendor is only sellable-from if their store is approved and switched on.
 * Mirrors the constraint `lib/products/storefront-products.ts` applies when
 * resolving a single vendor slug.
 */
const LIVE_VENDOR_CONSTRAINT = {
  status: VENDOR_STATUS.APPROVED,
  storeActive: { $ne: false },
} as const;

/**
 * Address visibility is a presentation choice, not a delivery-area choice.
 * Hidden-address vendors match through their own point or city, but their
 * precise distance is never returned to the storefront.
 */
function hidesPublicAddress(vendor: {
  storeVisibility?: { addressDisplay?: unknown };
}) {
  return (
    vendor.storeVisibility?.addressDisplay === VENDOR_ADDRESS_DISPLAY.HIDDEN
  );
}

// City suggestions are public metadata, unlike internal filtering. Keep a
// hidden vendor's city out of this endpoint even though the resolver may use
// its stored location to decide product eligibility.
const HIDDEN_ADDRESS_CONSTRAINT = {
  "storeVisibility.addressDisplay": VENDOR_ADDRESS_DISPLAY.HIDDEN,
} as const;

/**
 * Most vendors a single radius search will resolve.
 *
 * The result becomes a `Product.vendorId: { $in: [...] }`, so an uncapped answer
 * on a large marketplace turns one shopper's "everywhere" search into an `$in`
 * with every geocoded vendor in it. Nobody browses past a few hundred stores,
 * and `$near` orders nearest-first, so the ones dropped are always the furthest.
 */
const NEARBY_VENDOR_LIMIT = 500;

type NearbyVendorMatch = {
  vendorId: string;
  /**
   * Straight-line km from the shopper. Absent for a city-name match or a
   * hidden-address vendor, so the storefront never exposes a precise location
   * signal where the vendor opted out of publishing one.
   */
  distanceKm?: number;
  /** How this vendor was reached, so the UI can label it honestly. */
  via: "radius" | "city";
};

type NearbyVendorQuery = {
  /** Shopper's point. Omit to resolve by city name alone. */
  center?: LatLng | null;
  /** Kilometres. `null` means everywhere — no distance constraint at all. */
  radiusKm?: number | null;
  /**
   * City name typed or picked by the shopper. Used both as the fallback for
   * un-geocoded vendors and as the whole query when there is no center.
   */
  city?: string | null;
  /**
   * Answer only with merchants who have a real collection point in range.
   *
   * What this actually turns off is the city fallback. That pass matches on
   * `Vendor.address.city` and never looks at a branch at all, so it happily
   * returns a merchant with nowhere to collect from — fine for "show me local
   * sellers", a broken promise for "I want to pick this up".
   *
   * With no point to measure from, the question is unanswerable: the result is
   * an empty *filtered* answer, never `unfiltered`, so the caller shows nothing
   * rather than the whole catalogue under a filter that claims to narrow it.
   */
  requirePickupBranch?: boolean;
};

type NearbyVendorResult = {
  /** Every matching vendor id, deduped, nearest first where distance is known. */
  vendorIds: string[];
  matches: NearbyVendorMatch[];
  /**
   * Every collection point inside the radius, as ids.
   *
   * Kept alongside the vendor ids because "this seller has a counter near you"
   * and "this item is at a counter near you" are different claims, and only the
   * branch ids can answer the second. `getStorefrontProducts` uses them to
   * check per-branch stock for the collection facet; the vendor-level answer
   * above cannot, because a vendor's stock is the sum across all their branches
   * including the ones on the other side of the country.
   *
   * Empty for a city-name match, which never looks at a branch at all.
   */
  branchIds: string[];
  /**
   * True when the query had no location to act on, so the caller should skip
   * the vendor constraint entirely rather than filter to an empty list.
   */
  unfiltered: boolean;
};

const EMPTY_UNFILTERED: NearbyVendorResult = {
  vendorIds: [],
  matches: [],
  branchIds: [],
  unfiltered: true,
};

/**
 * Case- and whitespace-insensitive city match, anchored so "Dhaka" does not
 * also match "Dhakan". Escaped because a city name is shopper-supplied text and
 * would otherwise be injectable as a regex.
 */
function cityMatcher(city: string) {
  const escaped = city.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${escaped}\\s*$`, "i");
}

export async function findNearbyVendors(
  query: NearbyVendorQuery,
): Promise<NearbyVendorResult> {
  const center = query.center ?? null;
  const city = typeof query.city === "string" ? query.city.trim() : "";
  const hasFiniteRadius =
    Boolean(center) &&
    query.radiusKm !== null &&
    query.radiusKm !== undefined;

  // Nothing to filter on. Returning "unfiltered" rather than an empty match set
  // is what keeps a malformed location in the URL from emptying the catalogue.
  if (query.requirePickupBranch && !center) {
    // Not `EMPTY_UNFILTERED`: "collect near me" with no "me" must answer
    // nothing, not everything.
    return { vendorIds: [], matches: [], branchIds: [], unfiltered: false };
  }

  if (!center && !city) return EMPTY_UNFILTERED;

  await connectDB();

  const matches = new Map<string, NearbyVendorMatch>();
  // Only branches belonging to a vendor that survived the liveness check below.
  // A suspended store's counter is not somewhere anyone can be sent, so its
  // stock must not make a product look collectable either.
  const branchIds: string[] = [];

  // Radius pass, measured from the merchant's COLLECTION POINTS — the places a
  // shopper would actually walk into.
  //
  // It used to measure from `Vendor.address.geo`, the address collected for
  // payouts and KYC. `lib/vendor-address.ts` is explicit that address is not
  // for publication, and in practice it is often an accountant's office or a
  // home in a different city, so the distances were confidently wrong about
  // places nobody could visit. No comparable platform geocodes the seller:
  // Walmart and Target geocode stores, Shopify geocodes Locations, eBay
  // geocodes the listing's collection postcode. The geocoded thing is always
  // where the goods change hands.
  //
  // A null radius means "everywhere": the query still runs, because `$near` is
  // what produces the nearest-first ordering the distance sort relies on — it
  // just runs uncapped. Skipping it would return no one at all for a shopper
  // who set a location but no distance, which is the picker's default state.
  if (center) {
    const points = (await InventoryLocation.find({
      pickupEnabled: true,
      isActive: { $ne: false },
      // A branch with no address is not a place anyone can be sent to, and
      // `pickupLocationsForVendor` drops it at checkout for exactly that
      // reason. Matching it here would put a shop on the map that the checkout
      // then refuses to offer.
      address: { $nin: [null, ""] },
      geo: {
        $near: {
          $geometry: { type: "Point", coordinates: [center.lng, center.lat] },
          ...(query.radiusKm
            ? { $maxDistance: query.radiusKm * 1000 }
            : {}),
        },
      },
    })
      // Capped, because "everywhere" plus a point is the picker's default state
      // and would otherwise return every branch on the marketplace — then hand
      // all of them to the product query as one enormous `$in`. `$near` returns
      // nearest first, so what a cap drops is always the furthest.
      .limit(NEARBY_VENDOR_LIMIT)
      .select("_id vendorId geo")
      .lean()) as Array<{ _id: unknown; vendorId?: unknown; geo?: unknown }>;

    // A branch belongs to a vendor, but the vendor still has to be sellable:
    // a suspended or deactivated store's counter is not somewhere to send
    // anyone, and the location record knows nothing about store status.
    // Filtered BEFORE stringifying: `String(undefined)` is the truthy 9-char
    // string "undefined", which sails through `filter(Boolean)` and then makes
    // Mongoose throw a CastError on `$in` — taking down every location-filtered
    // listing on the site because one legacy branch never got an owner.
    // `vendorId` is deliberately optional on the model, so such rows exist.
    const vendorIds = Array.from(
      new Set(
        points
          .filter((p) => p.vendorId !== null && p.vendorId !== undefined)
          .map((p) => String(p.vendorId))
          .filter(Boolean),
      ),
    );
    const liveVendors = vendorIds.length
      ? ((await Vendor.find({
          ...LIVE_VENDOR_CONSTRAINT,
          _id: { $in: vendorIds },
        })
          .select("_id storeVisibility.addressDisplay")
          .lean()) as Array<{
          _id: unknown;
          storeVisibility?: { addressDisplay?: unknown };
        }>)
      : [];
    const liveById = new Map(liveVendors.map((v) => [String(v._id), v]));

    // `points` is already nearest-first, so the first branch seen for a vendor
    // is their closest one — which is the distance a shopper cares about.
    for (const branch of points) {
      const vendorId = String(branch.vendorId ?? "");
      const vendor = liveById.get(vendorId);
      if (!vendor) continue;

      // Every live branch, not just the nearest per vendor: a shopper with two
      // of the same merchant's shops in range can collect from either, so stock
      // sitting in the second one still makes the product collectable. Recorded
      // before the `matches` skip below, which deliberately keeps only the
      // closest branch per vendor because that is the distance a card shows.
      branchIds.push(String(branch._id));

      if (matches.has(vendorId)) continue;

      const point = latLngFromGeoPoint(branch.geo);
      matches.set(vendorId, {
        vendorId,
        // Recomputed rather than read back from Mongo: `$near` orders by
        // distance but does not return it, and `$geoNear` would force this
        // into an aggregation for a number the haversine gives for free.
        distanceKm:
          point && !hidesPublicAddress(vendor)
            ? distanceKm(center, point)
            : undefined,
        via: "radius",
      });
    }
  }

  // City pass keeps merchants reachable when no branch of theirs is geocoded —
  // skipped entirely under `requirePickupBranch`, since a city name proves
  // nothing about whether anything can be collected there.
  // a fresh install, or an address the geocoder could not place. It matches on
  // the vendor's registered city, which is a coarser signal than a branch point
  // but the only structured place name available; a location's address is free
  // text. A city cannot prove any individual branch is within a finite radius —
  // cities are far wider than 5 km — so strict radius searches rely only on the
  // branch points above.
  if (city && !hasFiniteRadius && !query.requirePickupBranch) {
    const cityVendors = (await Vendor.find({
      ...LIVE_VENDOR_CONSTRAINT,
      "address.city": cityMatcher(city),
    })
      .select("_id")
      .lean()) as Array<{ _id: unknown }>;

    for (const vendor of cityVendors) {
      const id = String(vendor._id);
      // A radius match already carries a real distance; do not downgrade it.
      if (matches.has(id)) continue;

      matches.set(id, { vendorId: id, via: "city" });
    }
  }

  // Nearest first, then everything without a distance. Callers that sort by
  // price or recency override this; callers sorting by distance rely on it.
  const ordered = [...matches.values()].sort((a, b) => {
    if (a.distanceKm === undefined && b.distanceKm === undefined) return 0;
    if (a.distanceKm === undefined) return 1;
    if (b.distanceKm === undefined) return -1;
    return a.distanceKm - b.distanceKm;
  });

  return {
    vendorIds: ordered.map((match) => match.vendorId),
    matches: ordered,
    branchIds,
    unfiltered: false,
  };
}

type MarketplaceCity = {
  city: string;
  /**
   * Shown beside the city to tell two same-named places apart — "Palmer" is a
   * town in both Alaska and Massachusetts. Absent when the vendors there never
   * filled a country in, which is common enough that the picker must render
   * without it rather than print a placeholder.
   *
   * Display only: the storefront filters on `city` alone, because that is what
   * `?city=` carries and what vendor addresses are matched against.
   */
  country?: string;
  vendorCount: number;
};

/** Public city metadata must never carry a vendor's exact stored point. */
export function marketplaceCityForPicker({
  city,
  country,
  vendorCount,
}: {
  city: string;
  country?: string | null;
  vendorCount: number;
}): MarketplaceCity {
  const label = country?.trim();
  return label ? { city, country: label, vendorCount } : { city, vendorCount };
}

/**
 * Cities that currently have sellable products, for the picker's suggestion
 * list. Counted by vendor rather than by product: the number tells a shopper
 * how many *stores* are there, and counting products would need a join per city
 * on a list rendered on every page.
 *
 * Cached because the picker renders on every storefront page while the answer
 * changes only when a vendor's address or status does — both of which already
 * invalidate the `products` tag.
 */
/**
 * Longest list the cities endpoint will return.
 *
 * The picker shows eight and searches for the rest, so a shopper never scrolls
 * anywhere near this. It exists to keep a marketplace with thousands of cities
 * from shipping the whole set to every device that opens the popover.
 */
export const MARKETPLACE_CITY_LIMIT = 50;

/**
 * Narrow the cached city list to a shopper's typed query.
 *
 * Filtering here rather than in Mongo keeps the single cached aggregate serving
 * every search: the full list is already in memory on the server, and a
 * per-keystroke query would miss the cache on every letter.
 *
 * Prefix matches rank above interior ones, so typing "dha" offers Dhaka before
 * Gandhinagar. Ties keep the vendor-count order the aggregate produced.
 */
export function filterMarketplaceCities(
  cities: MarketplaceCity[],
  query: string | null | undefined,
  limit: number = MARKETPLACE_CITY_LIMIT,
): MarketplaceCity[] {
  const needle = query?.trim().toLowerCase() ?? "";
  if (!needle) return cities.slice(0, limit);

  const ranked: Array<{ city: MarketplaceCity; rank: number }> = [];
  for (const city of cities) {
    const index = city.city.toLowerCase().indexOf(needle);
    if (index === 0) ranked.push({ city, rank: 0 });
    else if (index > 0) ranked.push({ city, rank: 1 });
  }

  // Stable across equal ranks, so vendor-count ordering survives the sort.
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((entry) => entry.city);
}

export const getMarketplaceCities = unstable_cache(
  async (): Promise<MarketplaceCity[]> => {
    return queryMarketplaceCities();
  },
  ["marketplace-cities"],
  {
    revalidate: 300,
    tags: [CACHE_TAGS.products],
  },
);

async function queryMarketplaceCities(): Promise<MarketplaceCity[]> {
  await connectDB();

  const rows = await Vendor.aggregate<{
    _id: string;
    country?: string | null;
    vendorCount: number;
  }>([
    {
      $match: {
        ...LIVE_VENDOR_CONSTRAINT,
        ...{ $nor: [HIDDEN_ADDRESS_CONSTRAINT] },
        "address.city": { $nin: [null, ""] },
      },
    },
    // Group case-insensitively so "dhaka" and "Dhaka" are one city, but keep a
    // real spelling to display rather than showing the shopper a lowercased one.
    //
    // Keyed on the city alone, never on city+country: `?city=` filters by city
    // name, so a city split into two rows by disagreeing country spellings would
    // show two entries that both lead to the same unsplit set of vendors.
    {
      $group: {
        _id: { $toLower: { $trim: { input: "$address.city" } } },
        display: { $first: { $trim: { input: "$address.city" } } },
        countries: {
          $addToSet: {
            $let: {
              vars: {
                name: {
                  $trim: { input: { $ifNull: ["$address.country", ""] } },
                },
              },
              // Empty strings would otherwise become a distinct "country" and
              // make a single-country city look ambiguous.
              in: { $cond: [{ $eq: ["$$name", ""] }, "$$REMOVE", "$$name"] },
            },
          },
        },
        vendorCount: { $sum: 1 },
      },
    },
    { $sort: { vendorCount: -1, display: 1 } },
    {
      $project: {
        _id: "$display",
        vendorCount: 1,
        // Only when the city's vendors agree. Vendors writing "BD" and
        // "Bangladesh" for one place must not have one spelling picked as the
        // truth, and a genuinely cross-border city name has no single answer.
        country: {
          $cond: [
            { $eq: [{ $size: "$countries" }, 1] },
            { $first: "$countries" },
            null,
          ],
        },
      },
    },
  ]);

  return rows.map((row) =>
    marketplaceCityForPicker({
      city: row._id,
      country: row.country,
      vendorCount: row.vendorCount,
    }),
  );
}
