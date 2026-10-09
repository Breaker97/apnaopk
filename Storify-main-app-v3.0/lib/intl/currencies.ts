import { DEFAULT_CURRENCY } from "@/config/branding.config";
import { normalizeCurrencyCode } from "@/lib/intl/currency-codes";

/**
 * Currency display metadata.
 *
 * Lives here — not in `providers/currency-provider` — because server components
 * and route handlers need the same symbol/locale mapping the client store uses.
 * The provider is a `"use client"` module, so importing it from a server file
 * would drag a client boundary into the server graph.
 */
export interface Currency {
  code: string;
  symbol: string;
  name: string;
  locale: string;
}

export const CURRENCIES: Currency[] = [
  { code: "USD", symbol: "$", name: "US Dollar", locale: "en-US" },
  { code: "EUR", symbol: "€", name: "Euro", locale: "de-DE" },
  { code: "GBP", symbol: "£", name: "British Pound", locale: "en-GB" },
  { code: "BDT", symbol: "৳", name: "Bangladeshi Taka", locale: "bn-BD" },
  { code: "INR", symbol: "₹", name: "Indian Rupee", locale: "en-IN" },
  { code: "TRY", symbol: "₺", name: "Turkish Lira", locale: "tr-TR" },
  { code: "PKR", symbol: "₨", name: "Pakistani Rupee", locale: "ur-PK" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen", locale: "ja-JP" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan", locale: "zh-CN" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar", locale: "en-AU" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar", locale: "en-CA" },
  { code: "PEN", symbol: "S/", name: "Peruvian Sol", locale: "es-PE" },
  { code: "SAR", symbol: "﷼", name: "Saudi Riyal", locale: "ar-SA" },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham", locale: "ar-AE" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", locale: "en-SG" },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit", locale: "ms-MY" },
  { code: "THB", symbol: "฿", name: "Thai Baht", locale: "th-TH" },
  { code: "KRW", symbol: "₩", name: "South Korean Won", locale: "ko-KR" },
  { code: "ZAR", symbol: "R", name: "South African Rand", locale: "en-ZA" },
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling", locale: "en-KE" },
  { code: "UGX", symbol: "USh", name: "Ugandan Shilling", locale: "en-UG" },
  { code: "NGN", symbol: "₦", name: "Nigerian Naira", locale: "en-NG" },
  { code: "DZD", symbol: "د.ج", name: "Algerian Dinar", locale: "ar-DZ" },
  { code: "QAR", symbol: "ر.ق", name: "Qatari Riyal", locale: "ar-QA" },
  { code: "KWD", symbol: "د.ك", name: "Kuwaiti Dinar", locale: "ar-KW" },
  { code: "BHD", symbol: ".د.ب", name: "Bahraini Dinar", locale: "ar-BH" },
  { code: "OMR", symbol: "ر.ع.", name: "Omani Rial", locale: "ar-OM" },
  // Orange Money's footprint. Listed for the same reason UGX and KES are: a
  // gateway whose settlement currency an admin cannot pick from the catalogue
  // can never be switched on, and "add it by hand" is not a discoverable step.
  // The four CFA-family codes are zero-decimal — see currencyMinorUnitExponent.
  { code: "XOF", symbol: "F CFA", name: "West African CFA Franc", locale: "fr-CI" },
  { code: "XAF", symbol: "FCFA", name: "Central African CFA Franc", locale: "fr-CM" },
  { code: "MGA", symbol: "Ar", name: "Malagasy Ariary", locale: "mg-MG" },
  { code: "GNF", symbol: "FG", name: "Guinean Franc", locale: "fr-GN" },
  { code: "SLE", symbol: "Le", name: "Sierra Leonean Leone", locale: "en-SL" },
  { code: "CDF", symbol: "FC", name: "Congolese Franc", locale: "fr-CD" },
  { code: "BWP", symbol: "P", name: "Botswanan Pula", locale: "en-BW" },
  { code: "LRD", symbol: "L$", name: "Liberian Dollar", locale: "en-LR" },
  // The rest of Pesapal's East African settlement set; KES and UGX were
  // already here, these four were not.
  { code: "TZS", symbol: "TSh", name: "Tanzanian Shilling", locale: "sw-TZ" },
  { code: "RWF", symbol: "RF", name: "Rwandan Franc", locale: "rw-RW" },
  { code: "ZMW", symbol: "K", name: "Zambian Kwacha", locale: "en-ZM" },
  { code: "MWK", symbol: "MK", name: "Malawian Kwacha", locale: "en-MW" },
];

/**
 * Metadata for a currency code. Admins may configure any ISO 4217 code, so an
 * unknown code degrades to using the code itself as its own symbol rather than
 * silently falling back to USD — a "$" on a store that never chose dollars is
 * worse than a bare "SEK".
 */
export function resolveCurrency(code: string | null | undefined): Currency {
  const normalized = normalizeCurrencyCode(code);
  const known = CURRENCIES.find((entry) => entry.code === normalized);
  if (known) return known;

  const fallbackCode = normalized || DEFAULT_CURRENCY;
  return {
    code: fallbackCode,
    symbol: fallbackCode,
    name: fallbackCode,
    locale: "en-US",
  };
}

