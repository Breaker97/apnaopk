/**
 * Geocoding against Nominatim: addresses to points (vendors), and points back
 * to a place name (the shopper's "Deliver to" line).
 *
 * The storefront's Directions button used to hand Google Maps the address as a
 * text query, which is a *search*: "Seattle 4214, Washington" lands on whatever
 * Google thinks is closest, and for anything but a well-known business that is
 * routinely the wrong block or the wrong city entirely. Resolving the address
 * to coordinates once, at save time, makes the pin exact — the deep link then
 * carries lat/lng instead of a phrase to guess at.
 *
 * The reverse direction answers a different question — "what is this point
 * called" — for `reverseGeocode`, which turns the coarse coordinate the browser
 * hands the location picker into something a shopper recognises. Both share one
 * rate-limit gate below, because Nominatim's policy is per client, not per
 * endpoint.
 *
 * Uses Nominatim (OpenStreetMap): no API key, no per-request billing. Its usage
 * policy requires an identifying User-Agent and at most one request per second,
 * both of which this module honours.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

/** Nominatim's policy asks for a real contact; the app URL is the honest one. */
const USER_AGENT = `Storify/1.0 (${
  process.env.NEXT_PUBLIC_APP_URL || "https://storify.app"
})`;

/**
 * Nominatim asks for =<1 req/sec, so every lookup takes a slot in one queue.
 *
 * A bare "has 1.1s passed" check was enough while the only caller was a vendor
 * save, which happens once and alone. `reverseGeocode` is reached from a public
 * endpoint, where two shoppers pressing "use my location" in the same second
 * both read the same `lastRequestAt`, both wait the same gap, and then fire
 * together — breaching the policy exactly when traffic makes it matter. Chaining
 * the waits makes them queue behind each other instead.
 *
 * The queue is per process: replicas each keep their own. That is the same
 * exposure the forward lookup always had, and the reverse cache plus the depth
 * cap below keep the shopper-facing side from being the one that trips it.
 */
const MIN_REQUEST_GAP_MS = 1100;
let lastRequestAt = 0;
let requestGate: Promise<void> = Promise.resolve();
let queuedLookups = 0;

/** Wait for this caller's turn. Resolves once it is clear to fetch. */
function takeRequestSlot(): Promise<void> {
  queuedLookups += 1;

  const slot = requestGate.then(async () => {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();
    queuedLookups -= 1;
  });

  // The tail must never be a rejected promise: one failure would otherwise
  // wedge every lookup queued behind it for the life of the process.
  requestGate = slot.catch(() => {});
  return slot;
}

/** Beyond this the address is almost certainly unreachable, not just slow. */
const REQUEST_TIMEOUT_MS = 5000;

export interface GeoCoordinates {
  lat: number;
  lng: number;
  /**
   * What the geocoder actually matched, kept so a vendor can see whether it
   * understood their address and so support can debug a wrong pin without
   * re-running the lookup.
   */
  formatted?: string;
  /** ISO timestamp of the lookup, used to decide when a re-geocode is due. */
  geocodedAt?: string;
}

interface GeocodeAddressInput {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/** The address parts, in the order a geocoder reads them best. */
function addressParts(address: GeocodeAddressInput): string[] {
  return [
    address.street,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);
}

/**
 * The single string identifying this address. Callers compare it across saves:
 * when it is unchanged there is nothing to re-geocode, which is what keeps an
 * unrelated edit (a phone number, a description) from spending a network round
 * trip and from disturbing coordinates that are already correct.
 */
export function addressGeocodeKey(address: GeocodeAddressInput): string {
  return addressParts(address).join(", ").toLowerCase();
}

function isUsableCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // 0,0 is in the Atlantic. It is what a failed parse produces far more often
    // than it is a real vendor location, so it is treated as no answer.
    !(lat === 0 && lng === 0)
  );
}

/**
 * Resolve an address to coordinates, or `null` when it cannot be resolved.
 *
 * Never throws: geocoding is an enhancement to the Directions button, so a
 * network failure or an unrecognised address must leave the vendor's save
 * succeeding with the address stored exactly as typed. The caller keeps any
 * previously-known coordinates in that case rather than clearing them.
 */
export async function geocodeAddress(
  address: GeocodeAddressInput,
): Promise<GeoCoordinates | null> {
  // Nominatim AND-s every term in the query, so one part it cannot match sinks
  // the whole lookup — a non-standard state abbreviation ("DHK" for Dhaka) or a
  // house number it has never seen returns nothing at all, even when the rest
  // of the address is unambiguous. Each attempt drops the part most likely to
  // be the blocker, so a good address degrades to a coarser pin instead of to
  // no pin. Ordered most- to least-precise; the first hit wins.
  for (const attempt of geocodeAttempts(address)) {
    const parts = addressParts(attempt);
    // A country on its own resolves to the centroid of a nation — technically a
    // coordinate, useless as a pin. Two parts is the floor for a real place.
    if (parts.length < 2) continue;

    const resolved = await lookup(parts.join(", "));
    if (resolved) return resolved;
  }

  return null;
}

/**
 * Progressively coarser versions of an address, each dropping the part most
 * likely to be unmatchable. Duplicates are filtered by the caller's key so a
 * missing field never costs a redundant network round trip.
 */
function geocodeAttempts(
  address: GeocodeAddressInput,
): GeocodeAddressInput[] {
  const attempts: GeocodeAddressInput[] = [
    address,
    // State is the usual offender: vendors type codes ("DHK", "AK") that
    // Nominatim treats as literal text rather than as a region.
    { ...address, state: undefined },
    // Then the postal code, which is wrong or absent often enough to matter.
    { ...address, state: undefined, postalCode: undefined },
    // Then the street, which fails for new developments and informal addresses.
    { ...address, state: undefined, postalCode: undefined, street: undefined },
  ];

  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    const key = addressGeocodeKey(attempt);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One rate-limited Nominatim call. Never throws; `null` means no answer. */
async function lookup(query: string): Promise<GeoCoordinates | null> {
  await takeRequestSlot();

  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    addressdetails: "0",
  })}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) return null;

    const results = (await response.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
    }>;

    const match = Array.isArray(results) ? results[0] : undefined;
    if (!match) return null;

    const lat = Number.parseFloat(match.lat ?? "");
    const lng = Number.parseFloat(match.lon ?? "");
    if (!isUsableCoordinate(lat, lng)) return null;

    return {
      lat,
      lng,
      formatted:
        typeof match.display_name === "string" ? match.display_name : undefined,
      geocodedAt: new Date().toISOString(),
    };
  } catch {
    // Timeout, DNS failure, malformed JSON — all mean "no coordinates today".
    return null;
  }
}

/**
 * Normalize stored coordinates read back from the database, dropping anything
 * that is not a usable point. Documents written before this field existed, or
 * by an older client, come back as undefined rather than as a bad pin.
 */
export function resolveCoordinates(value: unknown): GeoCoordinates | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<GeoCoordinates>;
  if (!isUsableCoordinate(raw.lat, raw.lng)) return undefined;

  return {
    lat: raw.lat as number,
    lng: raw.lng as number,
    formatted:
      typeof raw.formatted === "string" && raw.formatted.trim()
        ? raw.formatted.trim()
        : undefined,
    geocodedAt:
      typeof raw.geocodedAt === "string" && raw.geocodedAt.trim()
        ? raw.geocodedAt
        : undefined,
  };
}

/**
 * A coordinate's name, as a shopper would say it.
 *
 * `label` is the "Deliver to" line — locality and postcode where both are
 * known ("Bronx 10462"), which is how every marketplace header prints a place.
 * `city` is the one part an address form can safely be pre-filled with: the
 * point behind it is coarsened to ~1.1 km, so the city holds where a postcode
 * or a street would already be guessing at a neighbour's.
 */
interface ReverseGeocodedPlace {
  label: string;
  city?: string;
}

/**
 * How many lookups may be waiting before a reverse request gives up unasked.
 *
 * The name is a nicety — a shopper whose lookup is skipped still gets a working
 * location, labelled "Near me". Waiting six seconds in a queue for it is not,
 * and a burst of shoppers must not push a vendor's save (which has no fallback)
 * to the back of a long line.
 */
const MAX_QUEUED_REVERSE_LOOKUPS = 4;

/**
 * Points repeat: coordinates arrive already snapped to a ~1.1 km grid, so one
 * neighbourhood is one key however many shoppers stand in it. Successes only —
 * caching a `null` would pin a momentary outage in place for the whole process.
 */
const reverseCache = new Map<string, ReverseGeocodedPlace>();
const REVERSE_CACHE_LIMIT = 500;

/** The first non-blank string among the candidates, trimmed. */
function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return undefined;
}

/**
 * Name a point, or `null` when it cannot be named.
 *
 * Never throws, for the same reason the forward direction does not: the label
 * is decoration on a location that already works, so an outage must leave the
 * shopper with "Near me" rather than an error.
 *
 * `language` is the storefront's own locale. Nominatim answers in the local
 * language by default, so without it an English store prints "জোয়ার সাহারা"
 * in its header — the right place, in an alphabet that page does not use.
 *
 * Callers must pass an already-coarsened coordinate (`roundShopperCoordinate`);
 * this is the point at which a shopper's position leaves the deployment.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  language?: string,
): Promise<ReverseGeocodedPlace | null> {
  if (!isUsableCoordinate(lat, lng)) return null;

  // Language is part of the key: one point has as many names as the store has
  // locales, and serving the Bengali one to an English shopper is the bug this
  // parameter exists to avoid.
  const key = `${lat},${lng},${language || ""}`;
  const cached = reverseCache.get(key);
  if (cached) return cached;

  if (queuedLookups >= MAX_QUEUED_REVERSE_LOOKUPS) return null;

  const place = await reverseLookup(lat, lng, language);
  if (!place) return null;

  // Oldest out first. Map iterates in insertion order, so the eviction needs no
  // bookkeeping of its own.
  if (reverseCache.size >= REVERSE_CACHE_LIMIT) {
    const oldest = reverseCache.keys().next().value;
    if (oldest !== undefined) reverseCache.delete(oldest);
  }
  reverseCache.set(key, place);

  return place;
}

/** One rate-limited reverse call. Never throws; `null` means no answer. */
async function reverseLookup(
  lat: number,
  lng: number,
  language?: string,
): Promise<ReverseGeocodedPlace | null> {
  await takeRequestSlot();

  const url = `${NOMINATIM_REVERSE_URL}?${new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: "jsonv2",
    addressdetails: "1",
    // Suburb level. The coordinate is already a ~1.1 km square, so a
    // building-level zoom would print a street the shopper is not standing on.
    zoom: "14",
    // Names in the page's own language where OpenStreetMap has them, falling
    // back to the local name where it does not.
    ...(language ? { "accept-language": language } : {}),
  })}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      address?: Record<string, unknown>;
    };
    const address = payload?.address;
    if (!address || typeof address !== "object") return null;

    // Ordered small to large. Nominatim fills whichever of these the country's
    // data has, so the first hit is the most local name that exists.
    const locality = firstText(
      address.neighbourhood,
      address.suburb,
      address.city_district,
      address.borough,
      address.town,
      address.village,
      address.municipality,
      address.city,
      address.county,
    );
    const city = firstText(
      address.city,
      address.town,
      address.village,
      address.municipality,
      address.county,
      address.state,
    );
    const postcode = firstText(address.postcode);

    const label =
      [locality, postcode].filter(Boolean).join(" ") ||
      city ||
      firstText(address.state, address.country);
    if (!label) return null;

    return city ? { label, city } : { label };
  } catch {
    // Timeout, DNS failure, malformed JSON — all mean "no name today".
    return null;
  }
}
