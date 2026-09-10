import {
  currencyDisplayName,
  normalizeCurrencyCode,
} from "@/lib/intl/currency-codes";

export const LANGUAGE_OPTIONS = [
  { code: "en", name: "English" },
  { code: "bn", name: "Bengali" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "de", name: "German" },
  { code: "tr", name: "Turkish" },
  { code: "zu", name: "Zulu" },
  { code: "xh", name: "Xhosa" },
  { code: "af", name: "Afrikaans" },
  { code: "sw", name: "Swahili" },
  { code: "ha", name: "Hausa" },
  { code: "yo", name: "Yoruba" },
  { code: "ig", name: "Igbo" },
];

/**
 * Quick-pick currency list.
 *
 * Not a whitelist: admins can add any ISO 4217 code from the settings UI, so
 * this is only the shortlist rendered by default — see `currencyOptionsFor`.
 */
export const CURRENCY_OPTIONS = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "INR", name: "Indian Rupee" },
  { code: "TRY", name: "Turkish Lira" },
  { code: "PKR", name: "Pakistani Rupee" },
  { code: "BDT", name: "Bangladeshi Taka" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "PEN", name: "Peruvian Sol" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "AED", name: "UAE Dirham" },
  { code: "ZAR", name: "South African Rand" },
  { code: "KES", name: "Kenyan Shilling" },
  { code: "UGX", name: "Ugandan Shilling" },
  { code: "NGN", name: "Nigerian Naira" },
  { code: "DZD", name: "Algerian Dinar" },
  { code: "QAR", name: "Qatari Riyal" },
  { code: "KWD", name: "Kuwaiti Dinar" },
  { code: "BHD", name: "Bahraini Dinar" },
  { code: "OMR", name: "Omani Rial" },
  // Orange Money's settlement currencies, and the rest of Pesapal's. A gateway
  // whose currency is not offered here cannot be switched on at all: the
  // storefront hides it unless the store currency is one it settles.
  { code: "XOF", name: "West African CFA Franc" },
  { code: "XAF", name: "Central African CFA Franc" },
  { code: "MGA", name: "Malagasy Ariary" },
  { code: "GNF", name: "Guinean Franc" },
  { code: "SLE", name: "Sierra Leonean Leone" },
  { code: "CDF", name: "Congolese Franc" },
  { code: "BWP", name: "Botswanan Pula" },
  { code: "LRD", name: "Liberian Dollar" },
  { code: "TZS", name: "Tanzanian Shilling" },
  { code: "RWF", name: "Rwandan Franc" },
  { code: "ZMW", name: "Zambian Kwacha" },
  { code: "MWK", name: "Malawian Kwacha" },
];

/**
 * The shortlist above plus any code the admin added themselves, so a currency
 * that isn't bundled still renders as a togglable option once it is selected.
 */
export function currencyOptionsFor(
  selected: string[],
): { code: string; name: string }[] {
  const seen = new Set(CURRENCY_OPTIONS.map((c) => c.code));
  const custom: { code: string; name: string }[] = [];

  for (const entry of selected) {
    const code = normalizeCurrencyCode(entry);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    custom.push({ code, name: currencyDisplayName(code) });
  }

  return [...CURRENCY_OPTIONS, ...custom];
}

/** "USD — US Dollar", falling back to the bare code for unknown currencies. */
export function currencyLabel(code: string): string {
  const name =
    CURRENCY_OPTIONS.find((c) => c.code === code)?.name ||
    currencyDisplayName(code);
  return name ? `${code} — ${name}` : code;
}
