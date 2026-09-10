/**
 * Currency code helpers.
 *
 * The store currency is admin-controlled (`settings.general.defaultCurrency`)
 * and admins can add any code to `settings.general.supportedCurrencies` from
 * the settings UI, so codes are validated by *shape* (ISO 4217 is always three
 * letters) rather than against a bundled whitelist. Intl already knows the
 * display name and minor units of every real currency, so a code the app has
 * never heard of still formats and labels correctly.
 */

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export function normalizeCurrencyCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function isValidCurrencyCode(value: unknown): boolean {
  return CURRENCY_CODE_PATTERN.test(normalizeCurrencyCode(value));
}

/** Uppercase, de-duplicate and drop anything that is not a 3-letter code. */
export function sanitizeCurrencyCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes = new Set<string>();
  for (const entry of value) {
    const code = normalizeCurrencyCode(entry);
    if (CURRENCY_CODE_PATTERN.test(code)) codes.add(code);
  }
  return Array.from(codes);
}

let currencyDisplayNames: Intl.DisplayNames | null | undefined;

function getCurrencyDisplayNames() {
  if (currencyDisplayNames === undefined) {
    try {
      currencyDisplayNames = new Intl.DisplayNames(["en"], {
        type: "currency",
      });
    } catch {
      // Runtime without the currency display-name data — fall back to codes.
      currencyDisplayNames = null;
    }
  }
  return currencyDisplayNames;
}

/**
 * Human-readable name for a currency code, or "" when the runtime doesn't know
 * it. `Intl.DisplayNames.of()` echoes the input back for unknown codes, which
 * would otherwise render as "CHF — CHF".
 */
export function currencyDisplayName(code: string): string {
  const normalized = normalizeCurrencyCode(code);
  if (!CURRENCY_CODE_PATTERN.test(normalized)) return "";

  try {
    const name = getCurrencyDisplayNames()?.of(normalized);
    return name && name !== normalized ? name : "";
  } catch {
    return "";
  }
}
