import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import { countryCodeForValue } from "@/lib/intl/country-availability";

/**
 * Turn a phone number as people actually type it into the E.164 form an SMS
 * provider accepts ("+8801712345678"), or nothing.
 *
 * Every number this app holds is free text: a checkout's shipping phone, a
 * profile phone, a vendor's store phone. Most are written the national way
 * ("01712-345678", "(202) 555-0100", "07911 123456"), which only means
 * something next to a country — so the caller passes the country the number
 * was entered for (the shipping address's, the vendor's) and the store's
 * default as the fallback. A number already written internationally ("+44…",
 * "0044…", or the country code without a plus) needs neither.
 *
 * Returns undefined for anything that does not parse to a valid number rather
 * than guessing: a text sent to a wrong number is billed and read by a
 * stranger, which is worse than one not sent at all.
 */
export function normalizePhoneNumber(
  raw: unknown,
  options: {
    /** ISO-2 code or a country name — where this number was entered. */
    country?: unknown;
    /** ISO-2 code or a country name — the store's fallback. */
    defaultCountry?: unknown;
  } = {},
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!/\d/.test(value)) return undefined;

  const parsed = parsePhoneNumberFromString(
    value,
    toCountryCode(options.country) ?? toCountryCode(options.defaultCountry),
  );
  return parsed?.isValid() ? parsed.number : undefined;
}

/** The ISO-2 code libphonenumber knows for a stored country value, if any. */
function toCountryCode(value: unknown): CountryCode | undefined {
  const code = countryCodeForValue(value);
  return code && isSupportedCountry(code) ? code : undefined;
}

/**
 * A phone number for logs and admin screens, with the middle hidden:
 * "+880•••••5678". Enough to recognise a number you already know, not enough
 * to harvest one from a shared screen.
 */
export function maskPhoneNumber(e164: string): string {
  if (e164.length <= 7) return e164;
  return `${e164.slice(0, 4)}${"•".repeat(Math.max(3, e164.length - 8))}${e164.slice(-4)}`;
}
