/**
 * The store's country policy as a shape, without the list of countries.
 *
 * `normalizeCountryAvailability` (country-availability.ts) checks every code
 * against the full country list, 12 KB of JavaScript. The server runs it before
 * the policy reaches the browser (the root layout and `/api/settings/public`),
 * so the settings provider every page mounts only reads the shape, from here,
 * and no page carries the list for it.
 */

export const COUNTRY_AVAILABILITY_MODES = {
  ALL: "all",
  SELECTED: "selected",
} as const;

type CountryAvailabilityMode =
  (typeof COUNTRY_AVAILABILITY_MODES)[keyof typeof COUNTRY_AVAILABILITY_MODES];

/**
 * Store-wide country policy. ISO alpha-2 codes are used here even though some
 * legacy forms persist the country name; the helpers in country-availability.ts
 * bridge both shapes.
 */
export interface CountryAvailability {
  mode: CountryAvailabilityMode;
  countryCodes: string[];
}

export const DEFAULT_COUNTRY_AVAILABILITY: CountryAvailability = {
  mode: COUNTRY_AVAILABILITY_MODES.ALL,
  countryCodes: [],
};

/**
 * A policy the server already normalized, read back in the browser. Anything
 * but a `selected` list of codes is every country, as it is on the server.
 */
export function readCountryAvailability(value: unknown): CountryAvailability {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_COUNTRY_AVAILABILITY };
  }
  const input = value as Record<string, unknown>;
  const countryCodes = Array.isArray(input.countryCodes)
    ? input.countryCodes.filter((code): code is string => typeof code === "string")
    : [];
  return input.mode === COUNTRY_AVAILABILITY_MODES.SELECTED && countryCodes.length > 0
    ? { mode: COUNTRY_AVAILABILITY_MODES.SELECTED, countryCodes }
    : { ...DEFAULT_COUNTRY_AVAILABILITY };
}
