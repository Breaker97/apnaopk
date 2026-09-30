import { countryCodeForValue } from "@/lib/intl/country-availability";
import type { CheckoutSettings } from "@/lib/checkout/checkout-config";

/**
 * Whether the news-and-offers box may arrive already ticked.
 *
 * Shopify offers the same three answers — never, the regions it recommends,
 * or regions the merchant picks — because one global answer cannot be right:
 * a pre-ticked box is ordinary practice in some markets and not consent at all
 * in others. This is the "regions it recommends" list, and like Shopify's it
 * is a setting rather than legal advice: the merchant is the one who has to be
 * right about their own market.
 *
 * The countries here are those whose law requires consent to be given by a
 * positive act — the EU and EEA (GDPR/ePrivacy), the UK (PECR), Switzerland,
 * Canada (CASL) and Brazil (LGPD). Everywhere else follows the merchant's
 * setting.
 */
const OPT_IN_ONLY_COUNTRIES = new Set([
  // EU
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  // EEA and neighbours on the same rules
  "IS", "LI", "NO", "CH", "GB",
  // Elsewhere
  "CA", "BR",
]);

/** Whether this country is one where consent must be actively given. */
function requiresActiveOptIn(country: unknown): boolean {
  const code = countryCodeForValue(country);
  return code ? OPT_IN_ONLY_COUNTRIES.has(code) : false;
}

/**
 * The state the email marketing box starts in, for a shopper delivering to
 * `country`. An unknown country is treated as one that requires opting in:
 * the shopper has not said where they are yet, and a box ticked before they
 * do is the one case no reading of the rules allows.
 */
export function marketingBoxDefaultChecked(
  marketingOptIn: CheckoutSettings["contact"]["marketingOptIn"],
  country?: unknown,
): boolean {
  if (!marketingOptIn.enabled) return false;
  switch (marketingOptIn.preselect) {
    case "always":
      return true;
    case "auto":
      return Boolean(country) && !requiresActiveOptIn(country);
    case "countries": {
      const code = countryCodeForValue(country);
      return Boolean(code && marketingOptIn.preselectCountries.includes(code));
    }
    default:
      return false;
  }
}
