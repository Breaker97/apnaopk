import {
  currencyDisplayName,
  isValidCurrencyCode,
  normalizeCurrencyCode,
} from "@/lib/intl/currency-codes";
import { localeConfig, locales } from "@/config/i18n.config";

/**
 * The languages a store can offer: exactly the ones the app is translated
 * into. It used to be a hand-kept copy in three places that offered Korean
 * (no translation) and left out Dutch (fully translated). Each is named in its
 * own language, as the dashboard's language switcher names them; the English
 * name is there to search by.
 */
export const LANGUAGE_OPTIONS = locales.map((code) => ({
  code,
  name: localeConfig[code].nativeName,
  englishName: localeConfig[code].name.replace(/\s*\(.*\)$/, ""),
}));

/**
 * The currencies the store currency picker offers first. Not a whitelist:
 * `storeCurrencyOptions` follows them with every other ISO 4217 currency.
 */
const COMMON_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "TRY",
  "PKR",
  "BDT",
  "JPY",
  "CNY",
  "AUD",
  "CAD",
  "PEN",
  "SAR",
  "AED",
  "ZAR",
  "KES",
  "UGX",
  "NGN",
  "DZD",
  "QAR",
  "KWD",
  "BHD",
  "OMR",
  // Orange Money's settlement currencies, and the rest of Pesapal's. A gateway
  // whose currency is not offered here cannot be switched on at all: the
  // storefront hides it unless the store currency is one it settles.
  "XOF",
  "XAF",
  "MGA",
  "GNF",
  "SLE",
  "CDF",
  "BWP",
  "LRD",
  "TZS",
  "RWF",
  "ZMW",
  "MWK",
];

/**
 * The one store currency's picker: the common ones above first, then every
 * other ISO 4217 currency this runtime knows, and the store's own code even
 * when it is neither — so any real currency can still be chosen, as the old
 * "Add currency" field allowed.
 */
export function storeCurrencyOptions(
  current?: string,
  locale = "en",
): { value: string; label: string }[] {
  const known =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("currency")
      : [];
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const entry of [
    ...COMMON_CURRENCIES,
    ...known,
    current,
  ]) {
    const code = normalizeCurrencyCode(entry);
    if (!isValidCurrencyCode(code) || seen.has(code)) continue;
    seen.add(code);
    options.push({ value: code, label: currencyLabel(code, locale) });
  }
  return options;
}

/**
 * "USD — US Dollar", named in the admin's language, falling back to the bare
 * code for a currency the runtime does not know.
 */
function currencyLabel(code: string, locale: string): string {
  const name = currencyDisplayName(code, locale);
  return name ? `${code} — ${name}` : code;
}
