/**
 * GeoJSON projection of a vendor's geocoded address.
 *
 * `Vendor.address.coordinates` stores `{ lat, lng }` because that is what the
 * storefront's Directions link reads (see `lib/geocoding.ts`). MongoDB's
 * geospatial operators cannot query that shape at all — `$near`/`$geoNear`
 * require a GeoJSON Point on a `2dsphere` index, and a Point's coordinate array
 * is **[lng, lat]**, the reverse of how everyone says it out loud.
 *
 * Rather than migrate the existing field and break the Directions link, the geo
 * point is written alongside it as `address.geo`. This module owns the
 * conversion so the axis order is decided in exactly one place: getting it
 * backwards does not error, it silently relocates a Dhaka vendor (23.8, 90.4)
 * to a point off Antarctica (90.4, 23.8) — and 90.4 is not even a valid
 * latitude, so a chunk of the catalogue would simply vanish from every radius
 * search with no failure to trace.
 */

/** A GeoJSON Point, exactly as MongoDB's 2dsphere index expects it. */
export type VendorGeoPoint = {
  type: "Point";
  /** [longitude, latitude] — MongoDB's order, not conversational order. */
  coordinates: [number, number];
};

/** The `{ lat, lng }` shape written by the geocoder. */
export type LatLng = {
  lat: number;
  lng: number;
};

/**
 * Valid Earth coordinates. `2dsphere` rejects out-of-range values at insert
 * time, which would turn one bad vendor row into a failed save, so anything
 * unusable is filtered out here instead.
 *
 * Null Island (0,0) is treated as no answer: it is in the Atlantic, and it is
 * what a failed parse produces far more often than it is a real vendor.
 * `lib/geocoding.ts` applies the same rule when accepting a geocoder result.
 */
export function isUsableLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/**
 * Build the GeoJSON point for a vendor address, or `undefined` when the address
 * has no usable coordinates.
 *
 * Accepts the whole address (not just the coordinates) because callers hold an
 * address and should not have to reach into it — that reach is exactly where
 * the lat/lng swap tends to creep in.
 */
export function vendorGeoPoint(
  address: { coordinates?: Partial<LatLng> | null } | null | undefined,
): VendorGeoPoint | undefined {
  const coords = address?.coordinates;
  if (!coords) return undefined;

  const { lat, lng } = coords;
  if (!isUsableLatLng(lat, lng)) return undefined;

  return { type: "Point", coordinates: [lng as number, lat as number] };
}

/**
 * Read a stored `address.geo` back as `{ lat, lng }`, undoing the axis swap.
 * Returns `undefined` for documents written before this field existed or by a
 * client that wrote something malformed.
 */
export function latLngFromGeoPoint(value: unknown): LatLng | undefined {
  if (!value || typeof value !== "object") return undefined;

  const point = value as Partial<VendorGeoPoint>;
  if (point.type !== "Point" || !Array.isArray(point.coordinates)) {
    return undefined;
  }

  const [lng, lat] = point.coordinates;
  if (!isUsableLatLng(lat, lng)) return undefined;

  return { lat: lat as number, lng: lng as number };
}

/** Mean Earth radius (km), the standard sphere for `$geoNear`-style distances. */
const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in kilometres.
 *
 * MongoDB returns a distance from `$geoNear`, but not from the cheaper `$near`
 * used to resolve vendor ids, and never for a vendor matched through the
 * city-name fallback. This computes the "12 km away" label for those, so the
 * number on a product card comes from the same formula in every path.
 */
export function distanceKm(from: LatLng, to: LatLng): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Radius steps offered in the location picker, in kilometres.
 *
 * Snap points rather than a free-drag slider: the difference between a 37 km
 * and a 40 km radius is meaningless to a shopper, and discrete steps keep the
 * number of distinct cache keys small.
 */
export const RADIUS_STEPS_KM = [5, 10, 20, 40, 60, 100] as const;

/** Radius applied when a shopper sets a location without choosing a distance. */
export const DEFAULT_RADIUS_KM = 40;

/**
 * "Everywhere" as an index one past the last step.
 *
 * Both radius controls work in step *indices* rather than kilometres: the
 * offered radii are spaced 5→100, so a linear km track would bunch every useful
 * choice into its first third. Shared from here so the header picker and the
 * sidebar cannot drift into different ideas of which index means everywhere.
 */
export const EVERYWHERE_RADIUS_INDEX = RADIUS_STEPS_KM.length;

/** The radius a step index selects, or `null` for everywhere. */
export function radiusFromIndex(index: number): number | null {
  return index >= EVERYWHERE_RADIUS_INDEX ? null : RADIUS_STEPS_KM[index];
}

/**
 * The step index showing a radius, defaulting to everywhere.
 *
 * An unrecognised radius reads as everywhere rather than as a nearby step: the
 * value has already been through `normalizeRadiusKm` in every real path, so a
 * miss here means a hand-edited URL, and widening is the safer wrong answer —
 * it shows too many products rather than hiding a shopper's local ones.
 */
export function indexFromRadius(radiusKm: number | null): number {
  if (radiusKm === null) return EVERYWHERE_RADIUS_INDEX;

  const found = RADIUS_STEPS_KM.indexOf(
    radiusKm as (typeof RADIUS_STEPS_KM)[number],
  );
  return found === -1 ? EVERYWHERE_RADIUS_INDEX : found;
}

/**
 * Snap an arbitrary radius (a hand-edited URL, a stale link) to the nearest
 * offered step. Returns `null` for "everywhere", which is a real choice in the
 * picker and must survive a round trip through the URL.
 */
export function normalizeRadiusKm(value: unknown): number | null {
  if (value === null) return null;

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return RADIUS_STEPS_KM.reduce((closest, step) =>
    Math.abs(step - parsed) < Math.abs(closest - parsed) ? step : closest,
  );
}

/**
 * Coordinate precision used in cache keys, in decimal places.
 *
 * Storefront product queries are wrapped in `unstable_cache`, so a raw GPS
 * coordinate in the key would mint a fresh cache entry per shopper and defeat
 * the cache entirely. Two decimal places is a ~1 km grid: neighbours share a
 * cache entry, and the shift is far below the smallest 5 km radius.
 */
const CACHE_GRID_DECIMALS = 2;

/** Round a coordinate onto the shared cache grid. */
export function cacheGridCoordinate(value: number): number {
  const factor = 10 ** CACHE_GRID_DECIMALS;
  return Math.round(value * factor) / factor;
}
