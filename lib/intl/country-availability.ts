import {
  COUNTRIES as COUNTRY_OPTIONS,
  type RegionOption,
} from "@/lib/intl/country-options";

export const COUNTRY_AVAILABILITY_MODES = {
  ALL: "all",
  SELECTED: "selected",
} as const;

type CountryAvailabilityMode =
  (typeof COUNTRY_AVAILABILITY_MODES)[keyof typeof COUNTRY_AVAILABILITY_MODES];

/**
 * Store-wide country policy. ISO alpha-2 codes are used here even though some
 * legacy forms persist the country name; the helpers below bridge both shapes.
 */
export interface CountryAvailability {
  mode: CountryAvailabilityMode;
  countryCodes: string[];
}

export const DEFAULT_COUNTRY_AVAILABILITY: CountryAvailability = {
  mode: COUNTRY_AVAILABILITY_MODES.ALL,
  countryCodes: [],
};

const COUNTRY_BY_CODE = new Map(
  COUNTRY_OPTIONS.map((country) => [country.value.toUpperCase(), country]),
);

function normalizeLookupValue(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ")
    : "";
}

const COUNTRY_CODE_BY_NAME = new Map(
  COUNTRY_OPTIONS.map((country) => [
    normalizeLookupValue(country.label),
    country.value.toUpperCase(),
  ]),
);

// Common persisted/user-entered variants. Canonical picker values still use
// the labels in country-options.ts; aliases are only for compatibility and
// authoritative server-side checks.
const COUNTRY_CODE_ALIASES: Record<string, string> = {
  "congo, democratic republic of the": "CD",
  "czechia": "CZ",
  "democratic republic of congo": "CD",
  "dr congo": "CD",
  "cote d'ivoire": "CI",
  "côte d'ivoire": "CI",
  "côte d’ivoire": "CI",
  "ivory coast": "CI",
  "south korea": "KR",
  "republic of korea": "KR",
  "north korea": "KP",
  "russian federation": "RU",
  "turkiye": "TR",
  "u.k.": "GB",
  "uk": "GB",
  "united states of america": "US",
  "u.s.": "US",
  "usa": "US",
};

for (const [name, code] of Object.entries(COUNTRY_CODE_ALIASES)) {
  COUNTRY_CODE_BY_NAME.set(name, code);
}

export function isKnownCountryCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    COUNTRY_BY_CODE.has(value.trim().toUpperCase())
  );
}

export function sanitizeCountryCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toUpperCase())
        .filter((item) => COUNTRY_BY_CODE.has(item)),
    ),
  );
}

/**
 * Read-tolerant normalization. A corrupt/incomplete `selected` policy falls
 * back to `all`, keeping checkout usable; the admin write path rejects that
 * shape before it can be saved.
 */
export function normalizeCountryAvailability(
  value: unknown,
): CountryAvailability {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_COUNTRY_AVAILABILITY };
  }

  const input = value as Record<string, unknown>;
  const mode =
    input.mode === COUNTRY_AVAILABILITY_MODES.SELECTED
      ? COUNTRY_AVAILABILITY_MODES.SELECTED
      : COUNTRY_AVAILABILITY_MODES.ALL;
  const countryCodes = sanitizeCountryCodes(input.countryCodes);

  if (
    mode === COUNTRY_AVAILABILITY_MODES.SELECTED &&
    countryCodes.length > 0
  ) {
    return { mode, countryCodes };
  }

  return { ...DEFAULT_COUNTRY_AVAILABILITY };
}

/** Resolve either an ISO code or a canonical/legacy country name to ISO-2. */
export function countryCodeForValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const possibleCode = trimmed.toUpperCase();
  if (COUNTRY_BY_CODE.has(possibleCode)) return possibleCode;
  return COUNTRY_CODE_BY_NAME.get(normalizeLookupValue(trimmed));
}

export function countryNameForCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return COUNTRY_BY_CODE.get(value.trim().toUpperCase())?.label;
}

/**
 * Compare legacy names, aliases, and ISO codes without treating a harmless
 * representation change (for example `US` -> `United States`) as a new
 * country selection. Unknown legacy values still compare case-insensitively.
 */
export function areCountryValuesEquivalent(
  left: unknown,
  right: unknown,
): boolean {
  const leftCode = countryCodeForValue(left);
  const rightCode = countryCodeForValue(right);
  if (leftCode || rightCode) {
    return Boolean(leftCode && rightCode && leftCode === rightCode);
  }

  return normalizeLookupValue(left) === normalizeLookupValue(right);
}

export function getAllowedCountryOptions(
  availability: unknown,
): RegionOption[] {
  const normalized = normalizeCountryAvailability(availability);
  if (normalized.mode === COUNTRY_AVAILABILITY_MODES.ALL) {
    return COUNTRY_OPTIONS;
  }

  const allowed = new Set(normalized.countryCodes);
  return COUNTRY_OPTIONS.filter((country) => allowed.has(country.value));
}

/**
 * Filter a names-based legacy catalog without changing the emitted values.
 * Names we cannot map are retained only in `all` mode.
 */
export function getAllowedCountryNames(
  availability: unknown,
  countryNames: readonly string[],
): string[] {
  const normalized = normalizeCountryAvailability(availability);
  if (normalized.mode === COUNTRY_AVAILABILITY_MODES.ALL) {
    return [...countryNames];
  }

  const allowed = new Set(normalized.countryCodes);
  return countryNames.filter((country) => {
    const code = countryCodeForValue(country);
    return Boolean(code && allowed.has(code));
  });
}

/**
 * Authoritative check for routes that accept either a country name or ISO code.
 * `all` deliberately accepts existing free-text values for backwards
 * compatibility; `selected` only accepts values that resolve to an allowed code.
 */
export function isCountryAllowed(
  value: unknown,
  availability: unknown,
): boolean {
  const normalized = normalizeCountryAvailability(availability);
  if (normalized.mode === COUNTRY_AVAILABILITY_MODES.ALL) return true;

  const code = countryCodeForValue(value);
  return Boolean(code && normalized.countryCodes.includes(code));
}
