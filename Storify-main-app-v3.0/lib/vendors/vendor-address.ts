/**
 * The address parts this module reads. Declared structurally rather than
 * imported from `@/types` so `types/index.ts` can depend on this file for
 * `VendorStoreVisibility` without a circular import — the same arrangement
 * `lib/share-config.ts` uses. An `Address` is assignable to it.
 */
type VendorAddressInput = {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  /**
   * Resolved by the geocoder when the vendor saved this address. Present only
   * once a lookup succeeded, so every consumer must still handle its absence.
   */
  coordinates?: { lat: number; lng: number };
};

/**
 * How much of a vendor's postal address the storefront may reveal.
 *
 * The address on a Vendor document is collected for payouts and KYC, not for
 * publication — many vendors trade from home. So publication is opt-in and the
 * vendor picks the precision:
 *
 * - `hidden`       — no location at all. Buyers still see the shipping country,
 *                    which comes from the shipping profile, not this address.
 * - `city_country` — city + country only. Enough to read as a real business
 *                    without exposing a doorstep. The safe default, including
 *                    for vendors that predate this field.
 * - `full`         — street, city, state, postal code, country. For showrooms,
 *                    pickup points and registered businesses.
 */
export const VENDOR_ADDRESS_DISPLAY = {
  HIDDEN: "hidden",
  CITY_COUNTRY: "city_country",
  FULL: "full",
} as const;

export type VendorAddressDisplay =
  (typeof VENDOR_ADDRESS_DISPLAY)[keyof typeof VENDOR_ADDRESS_DISPLAY];

/** Ordered least- to most-revealing. A readonly tuple so `z.enum()` accepts it. */
export const VENDOR_ADDRESS_DISPLAY_VALUES = [
  VENDOR_ADDRESS_DISPLAY.HIDDEN,
  VENDOR_ADDRESS_DISPLAY.CITY_COUNTRY,
  VENDOR_ADDRESS_DISPLAY.FULL,
] as const;

/**
 * Safe default. Deliberately not `full`: existing approved vendors never
 * consented to publishing a street address, so a migration must not start
 * doing it for them.
 */
export const DEFAULT_VENDOR_ADDRESS_DISPLAY: VendorAddressDisplay =
  VENDOR_ADDRESS_DISPLAY.CITY_COUNTRY;

export interface VendorStoreVisibility {
  addressDisplay: VendorAddressDisplay;
  /**
   * Separate from the address decision on purpose — publishing a phone number
   * invites spam, so it is never implied by opting into `full`.
   */
  showPhone: boolean;
}

export const DEFAULT_VENDOR_STORE_VISIBILITY: VendorStoreVisibility = {
  addressDisplay: DEFAULT_VENDOR_ADDRESS_DISPLAY,
  showPhone: false,
};

export function normalizeVendorAddressDisplay(
  value: unknown,
): VendorAddressDisplay {
  return (VENDOR_ADDRESS_DISPLAY_VALUES as readonly string[]).includes(
    value as string,
  )
    ? (value as VendorAddressDisplay)
    : DEFAULT_VENDOR_ADDRESS_DISPLAY;
}

export function resolveVendorStoreVisibility(
  value: unknown,
): VendorStoreVisibility {
  const raw = (value ?? {}) as Partial<VendorStoreVisibility>;
  return {
    addressDisplay: normalizeVendorAddressDisplay(raw.addressDisplay),
    showPhone: raw.showPhone === true,
  };
}

/** Trim a possibly-missing address part down to a usable string. */
function part(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Turn a 2-letter country code into a display name so the storefront never
 * shows a bare "BD". Anything that isn't a recognised code is passed through
 * unchanged — vendors type free-text country names too.
 */
export function formatCountry(value: unknown, locale = "en"): string {
  const raw = part(value);
  if (!raw) return "";
  if (!/^[A-Za-z]{2}$/.test(raw)) return raw;

  try {
    const display = new Intl.DisplayNames([locale], { type: "region" });
    return display.of(raw.toUpperCase()) || raw;
  } catch {
    return raw;
  }
}

interface FormattedVendorAddress {
  /** One-line form for the info strip, e.g. "Dhaka, Bangladesh". */
  short: string;
  /**
   * Multi-line form for the details panel. Render with `lines.map()` — never
   * join with "\n" and hope CSS handles it.
   */
  lines: string[];
  /** Pre-encoded query for a maps deep link; empty when routing is pointless. */
  mapQuery: string;
  /**
   * Exact point for the maps link, when the address was successfully geocoded.
   * Preferred over `mapQuery` by `buildDirectionsUrl` — a text query is a
   * *search*, and searches land on the wrong block often enough that a stored
   * coordinate is the only way the pin reliably matches the real address.
   */
  coordinates?: { lat: number; lng: number };
}

/** A coordinate is only useful to route to at street precision. */
function usableCoordinates(
  address: VendorAddressInput,
  mode: VendorAddressDisplay,
): { lat: number; lng: number } | undefined {
  if (mode !== VENDOR_ADDRESS_DISPLAY.FULL) return undefined;
  const coords = address.coordinates;
  if (
    !coords ||
    typeof coords.lat !== "number" ||
    typeof coords.lng !== "number" ||
    !Number.isFinite(coords.lat) ||
    !Number.isFinite(coords.lng)
  ) {
    return undefined;
  }
  return { lat: coords.lat, lng: coords.lng };
}

/**
 * Format a vendor address for the storefront at the given precision.
 *
 * Returns `null` when there is nothing worth rendering, so callers can skip the
 * whole block rather than draw an empty bordered card. Every part is filtered
 * before joining, which is what keeps orphan output like ", , Bangladesh" from
 * ever reaching the page.
 */
export function formatVendorAddress(
  address: VendorAddressInput | undefined | null,
  mode: VendorAddressDisplay,
  locale = "en",
): FormattedVendorAddress | null {
  if (!address || mode === VENDOR_ADDRESS_DISPLAY.HIDDEN) return null;

  const city = part(address.city);
  const state = part(address.state);
  const country = formatCountry(address.country, locale);
  const short = [city, country].filter(Boolean).join(", ");

  if (mode === VENDOR_ADDRESS_DISPLAY.CITY_COUNTRY) {
    if (!short) return null;
    // No mapQuery: a city alone cannot route anyone, so the caller must not
    // offer a Directions button it can't honour.
    return { short, lines: [short], mapQuery: "" };
  }

  const street = part(address.street);
  const postalCode = part(address.postalCode);

  // "Banani, Dhaka 1213" on one line reads the way an address label does.
  const locality = [[city, state].filter(Boolean).join(", "), postalCode]
    .filter(Boolean)
    .join(" ");

  const lines = [street, locality, country].filter(Boolean);
  if (lines.length === 0) return null;

  return {
    short: short || lines[0],
    lines,
    mapQuery: lines.join(", "),
    coordinates: usableCoordinates(address, mode),
  };
}

/**
 * Google Maps deep link. Deliberately a link, not an embedded iframe.
 *
 * Given coordinates it drops a pin on the exact point; given only text it falls
 * back to a search, which is what every un-geocoded address still gets.
 */
export function buildDirectionsUrl(
  mapQuery: string,
  coordinates?: { lat: number; lng: number },
): string {
  if (coordinates) {
    // `query=lat,lng` is Maps' documented exact-point form. The extra
    // `query_place_id`-free shape keeps it a pure coordinate drop, so Maps does
    // not "helpfully" re-search the area and move the pin.
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${coordinates.lat},${coordinates.lng}`,
    )}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    mapQuery,
  )}`;
}
