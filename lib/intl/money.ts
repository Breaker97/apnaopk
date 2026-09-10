// Currencies with no minor unit — charged in whole units, so an amount must
// never be multiplied by 100. Charging UGX/JPY with a blanket ×100 overcharges
// the payer 100×.
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

// Currencies whose smallest unit is 1/1000.
const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
]);

/**
 * How many digits the currency's smallest unit has. Every gateway adapter
 * builds its charge with this exponent (`toStripeAmount`,
 * `toRazorpayAmountSubunits`, `toPaystackAmountSubunits`) and reports back in
 * the same unit, so anything comparing a stored price against a gateway-
 * reported amount MUST use it too — a hardcoded ×100 disagrees with the actual
 * charge for every non-2-decimal currency.
 */
export function currencyMinorUnitExponent(currency: string): number {
  const normalized = (currency || "USD").trim().toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(normalized)) return 3;
  return 2;
}

/**
 * Decimal places a *stored* price may use for a currency.
 *
 * Zero-decimal currencies accept whole units only. Three-decimal currencies are
 * deliberately quantised to 2 places rather than 3: Stripe requires their
 * smallest-unit amount to be a multiple of 10, so a third decimal would be
 * rounded away by the gateway and then fail the amount cross-check that guards
 * finalization.
 */
export function currencyPriceScale(currency: string): number {
  return currencyMinorUnitExponent(currency) === 0 ? 0 : 2;
}

/**
 * The smallest price a currency can express — 1 in its minor unit. In a
 * zero-decimal currency that is 1 whole unit, so a "0.50" typed into a form
 * that assumes cents is not a valid price at all.
 */
export function currencyMinimumPrice(currency: string): number {
  return 1 / 10 ** currencyPriceScale(currency);
}

/**
 * Round a price to something the currency can actually represent, so the
 * amount charged and the amount stored can never disagree.
 */
export function quantizeToCurrency(amount: number, currency: string): number {
  const factor = 10 ** currencyPriceScale(currency);
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  return roundScaled(value, factor);
}

/**
 * Half-up rounding that survives binary floating point. 1.005 is stored as
 * 1.00499999999999989…, so `Math.round(1.005 * 100)` lands on 100 — one cent
 * short of what every human (and every gateway) expects. Scaling first and
 * trimming the noise below the 15th significant digit, the precision a double
 * reliably carries, puts the product back on 100.5 before rounding. Ties still
 * round toward +∞ exactly as Math.round always did, so nothing that was right
 * before changes.
 */
function roundScaled(value: number, factor: number): number {
  return Math.round(Number((value * factor).toPrecision(15))) / factor;
}

/**
 * Compare two major-unit amounts at the currency's own precision. Used on the
 * finalization path, where `expected` is what we asked the gateway to collect
 * and `actual` is what it reports having collected.
 */
export function amountsMatchForCurrency(
  expected: number,
  actual: number,
  currency: string,
): boolean {
  const factor = 10 ** currencyMinorUnitExponent(currency);
  return Math.round(expected * factor) === Math.round(actual * factor);
}

/**
 * Pin a formatting locale to Western digits.
 *
 * Money is formatted with the *currency's* regional locale (BDT → bn-BD,
 * SAR → ar-SA) so the symbol, separators and symbol placement match the
 * currency — but that locale also carries a native numbering system, which
 * would print Bengali (১,২৩৪৳) or Arabic-Indic (١٬٢٣٤) numerals on an English
 * store. The currency is not a language choice, so digits stay Latin.
 */
function withLatinDigits(locale?: string): string | undefined {
  if (!locale) return locale;
  try {
    return new Intl.Locale(locale, { numberingSystem: "latn" }).toString();
  } catch {
    // Structurally invalid tag — Intl.NumberFormat would reject it too, so
    // fall back to the runtime default instead of throwing.
    return undefined;
  }
}

export function formatCurrency(
  amount: number,
  currency: string,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const currencyCode = (currency || "USD").toUpperCase();
  const formatLocale = withLatinDigits(locale);

  try {
    return new Intl.NumberFormat(formatLocale, {
      style: "currency",
      currency: currencyCode,
      ...options,
    }).format(safeAmount);
  } catch {
    const formatted = new Intl.NumberFormat(formatLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeAmount);
    return `${formatted} ${currencyCode}`;
  }
}

/**
 * Round to two decimals the way the order, return, discount and earnings maths
 * always has — half up, now float-safe (see `roundScaled`). Currency-aware
 * rounding (zero- and three-decimal currencies) is `quantizeToCurrency`; this
 * is the plain 2-dp helper those modules share so they all round identically.
 */
export function roundMoney(value: number): number {
  return roundScaled(value, 100);
}
