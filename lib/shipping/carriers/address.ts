import { countryCodeForValue } from "@/lib/intl/country-availability";
import type { ShipFromSource } from "@/lib/shipping/shipments";
import type { Address } from "@/types";
import { CARRIER_ERROR_CODES, CarrierError } from "./errors";
import type { CarrierAddress } from "./types";

/**
 * Turn a stored address into one a carrier will accept.
 *
 * Orders were never validated for carrier-grade addresses: `state` is free
 * text and `country` may be a display name rather than ISO-3166 alpha-2.
 * Sending that straight through produces an opaque provider 422 six retries
 * later, so the normalization and the refusal both live here — the caller gets
 * a permanent error naming the fields a human has to fix.
 */

/**
 * ISO-3166 alpha-2, or "" when the value names no country we know.
 *
 * `countryCodeForValue` already resolves codes, canonical names and the legacy
 * aliases stored on older orders ("USA", "U.K."), so carrier normalization
 * reuses it rather than growing a second, divergent lookup table.
 */
export function normalizeCountryCode(value: unknown): string {
  return countryCodeForValue(value)?.toUpperCase() ?? "";
}

/** Fields no carrier will ship without, anywhere. */
const REQUIRED_FIELDS = ["street1", "city", "postalCode", "country"] as const;

/**
 * Countries whose carriers reject an address with no subdivision.
 *
 * `state` is deliberately not globally required — Singapore, Malta and much of
 * Europe simply have none, and demanding one would refuse perfectly shippable
 * addresses. But a US or Indian address without it produces a provider 422 with
 * no useful message, so those are caught here where the merchant can be told
 * which field to fill in.
 */
const STATE_REQUIRED_COUNTRIES = new Set(["US", "CA", "AU", "IN"]);

/**
 * Postcode shapes for the countries where one is both required and fixed.
 *
 * A present-but-wrong postcode is worse than an absent one: it clears every
 * emptiness check here, survives the rate list — carriers price a lane from the
 * country and the city, not the postcode — and is only refused at the moment a
 * label is bought, as "Postcode not found. Expected formats: <country specific
 * post code format>", with no clue as to *which* of the two addresses is meant.
 * A US ZIP entered as six digits is the whole failure, and nothing before this
 * looked at it.
 *
 * Deliberately partial. Only countries whose civil format is unambiguous are
 * listed, because a wrong pattern here refuses an address the carrier would
 * have accepted — the strictly worse failure. Anything absent is passed through
 * untouched, exactly as `state` is for the countries that have none.
 */
const POSTAL_CODE_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
  IE: /^[A-Z]\d{2} ?[A-Z\d]{4}$/i,
  NL: /^\d{4} ?[A-Z]{2}$/i,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  IT: /^\d{5}$/,
  ES: /^\d{5}$/,
  PT: /^\d{4}-\d{3}$/,
  PL: /^\d{2}-\d{3}$/,
  SE: /^\d{3} ?\d{2}$/,
  AT: /^\d{4}$/,
  BE: /^\d{4}$/,
  CH: /^\d{4}$/,
  DK: /^\d{4}$/,
  NO: /^\d{4}$/,
  FI: /^\d{5}$/,
  AU: /^\d{4}$/,
  NZ: /^\d{4}$/,
  ZA: /^\d{4}$/,
  IN: /^\d{6}$/,
  BD: /^\d{4}$/,
  PK: /^\d{5}$/,
  CN: /^\d{6}$/,
  SG: /^\d{6}$/,
  JP: /^\d{3}-?\d{4}$/,
  TH: /^\d{5}$/,
  ID: /^\d{5}$/,
  PH: /^\d{4}$/,
  MY: /^\d{5}$/,
  TR: /^\d{5}$/,
  BR: /^\d{5}-?\d{3}$/,
  MX: /^\d{5}$/,
};

/** True when `postalCode` cannot be a postcode of `country` at all. */
function isPostalCodeShapeValid(
  postalCode: string,
  country: string,
): boolean {
  const pattern = POSTAL_CODE_PATTERNS[country.toUpperCase()];
  if (!pattern) return true;
  return pattern.test(postalCode.trim());
}

interface AddressReadiness {
  address: CarrierAddress;
  /** Fields with no value at all. */
  missing: string[];
  /**
   * Fields that are filled in but that no carrier will accept as written. Kept
   * apart from `missing` because "add a postcode" and "that postcode is not a
   * US one" send a merchant to different places.
   */
  invalid: string[];
}

export function toCarrierAddress(
  address: Partial<Address> | undefined,
  options: { fallbackName?: string; email?: string } = {},
): AddressReadiness {
  const name =
    String(address?.fullName || "").trim() ||
    [address?.firstName, address?.lastName].filter(Boolean).join(" ").trim() ||
    options.fallbackName ||
    "";

  const carrierAddress: CarrierAddress = {
    name,
    street1: String(address?.street || "").trim(),
    street2: String(address?.apartment || "").trim() || undefined,
    city: String(address?.city || "").trim(),
    state: String(address?.state || "").trim(),
    postalCode: String(address?.postalCode || "").trim(),
    country: normalizeCountryCode(address?.country),
    phone: String(address?.phone || "").trim() || undefined,
    email: options.email?.trim() || undefined,
  };

  const missing: string[] = REQUIRED_FIELDS.filter(
    (field) => !carrierAddress[field],
  );
  if (!name) missing.push("name");
  if (
    !carrierAddress.state &&
    STATE_REQUIRED_COUNTRIES.has(carrierAddress.country)
  ) {
    missing.push("state");
  }
  // A country we could not resolve is worse than a missing one — it looks
  // filled in but names nothing — so say so specifically.
  if (!carrierAddress.country && String(address?.country || "").trim()) {
    missing.push("country (unrecognised)");
  }

  const invalid: string[] = [];
  if (
    carrierAddress.postalCode &&
    carrierAddress.country &&
    !isPostalCodeShapeValid(carrierAddress.postalCode, carrierAddress.country)
  ) {
    invalid.push(
      `"${carrierAddress.postalCode}" is not a valid ${carrierAddress.country} postcode`,
    );
  }

  return { address: carrierAddress, missing, invalid };
}

/**
 * One sentence naming everything wrong with an address.
 *
 * Both faults are reported together rather than the first one found: a merchant
 * sent back to the same form twice for two fields on the same screen is a
 * second purchase attempt that also fails.
 */
function faultSummary(readiness: AddressReadiness): string {
  const parts: string[] = [];
  if (readiness.missing.length > 0) {
    parts.push(`missing ${readiness.missing.join(", ")}`);
  }
  parts.push(...readiness.invalid);
  return parts.join("; ");
}

/** Throw the permanent, human-actionable error for a destination we cannot use. */
export function assertShipToReady(readiness: AddressReadiness): CarrierAddress {
  if (readiness.missing.length > 0 || readiness.invalid.length > 0) {
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.ADDRESS_NOT_CARRIER_READY,
      message: `The delivery address cannot be shipped to: ${faultSummary(readiness)}`,
      permanent: true,
      fields: readiness.missing,
    });
  }
  return readiness.address;
}

/**
 * Same, for the origin. Split from the destination because the fix is in a
 * different place — Settings → Shipping, or the vendor's own profile — and
 * conflating them sends the merchant hunting in the wrong screen.
 */
export function assertShipFromReady(
  readiness: AddressReadiness,
  extra: { requirePhone?: boolean; source?: ShipFromSource } = {},
): CarrierAddress {
  const missing = [...readiness.missing];
  // Most carriers refuse a pickup with no contact number.
  if (extra.requirePhone !== false && !readiness.address.phone) {
    missing.push("phone");
  }
  if (missing.length > 0 || readiness.invalid.length > 0) {
    throw new CarrierError({
      code: CARRIER_ERROR_CODES.SHIP_FROM_INCOMPLETE,
      message: `The ship-from address cannot be shipped from: ${faultSummary({
        ...readiness,
        missing,
      })}. ${SHIP_FROM_FIX_LOCATION[extra.source ?? "none"]}`,
      permanent: true,
      fields: missing,
    });
  }
  return readiness.address;
}

/**
 * Where the address actually came from, so the merchant is sent to the screen
 * that owns it.
 *
 * `resolveShipFrom` falls through four sources, and the winner is whichever one
 * happens to name a country — a vendor's *profile* address beats the store's
 * configured shipping origin. Telling everyone to "complete it in Settings →
 * Shipping" is then simply wrong, and sends them to edit a record the parcel
 * never used.
 */
const SHIP_FROM_FIX_LOCATION: Record<ShipFromSource, string> = {
  vendor_origin: "Fix it in the vendor's shipping origin.",
  vendor_address:
    "This parcel ships from the vendor's own profile address, so fix it there — or give the vendor a shipping origin of its own.",
  store_origin: "Complete it in Settings → Shipping.",
  store_profile:
    "No shipping origin is set, so the store profile is being used. Set one in Settings → Shipping.",
  none: "Complete it in Settings → Shipping.",
};
