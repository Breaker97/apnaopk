/**
 * Currency code helpers.
 *
 * The store sells in one admin-chosen currency
 * (`settings.general.defaultCurrency`), which may be any ISO 4217 code, so
 * codes are validated by *shape* (always three letters) rather than against a
 * bundled whitelist. Intl already knows the display name and minor units of
 * every real currency, so a code the app has never heard of still formats and
 * labels correctly.
 */

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export function normalizeCurrencyCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isValidCurrencyCode(value: unknown): boolean {
  return CURRENCY_CODE_PATTERN.test(normalizeCurrencyCode(value));
}

const currencyDisplayNames = new Map<string, Intl.DisplayNames | null>();

function getCurrencyDisplayNames(locale: string) {
  if (!currencyDisplayNames.has(locale)) {
    try {
      currencyDisplayNames.set(
        locale,
        new Intl.DisplayNames([locale, "en"], { type: "currency" }),
      );
    } catch {
      // Runtime without the currency display-name data — fall back to codes.
      currencyDisplayNames.set(locale, null);
    }
  }
  return currencyDisplayNames.get(locale) ?? null;
}

/**
 * Human-readable name for a currency code in `locale` ("US Dollar", "মার্কিন
 * ডলার"), or "" when the runtime doesn't know it. `Intl.DisplayNames.of()`
 * echoes the input back for unknown codes, which would otherwise render as
 * "CHF — CHF".
 */
export function currencyDisplayName(code: string, locale = "en"): string {
  const normalized = normalizeCurrencyCode(code);
  if (!CURRENCY_CODE_PATTERN.test(normalized)) return "";

  try {
    const name = getCurrencyDisplayNames(locale)?.of(normalized);
    return name && name !== normalized ? name : "";
  } catch {
    return "";
  }
}
