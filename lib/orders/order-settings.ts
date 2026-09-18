export const DEFAULT_ORDER_PREFIX = "ORD";
export const DEFAULT_ORDER_TAX_RATE = 0;
export const DEFAULT_ORDER_SHIPPING_COST = 5;
export const DEFAULT_FREE_SHIPPING_THRESHOLD = 0;
export const DEFAULT_VENDOR_COMMISSION_RATE = 10;
export const DEFAULT_MIN_WITHDRAWAL_AMOUNT = 50;

type MinWithdrawalSettingsLike = {
  general?: { defaultCurrency?: string | null } | null;
  orders?: {
    commission?: {
      minWithdrawalAmount?: number | null;
      minWithdrawalByCurrency?: Map<string, number> | Record<string, number> | null;
    } | null;
  } | null;
} | null | undefined;

/**
 * The smallest payout the store makes in `currency`.
 *
 * The minimum was one number with no currency, compared as it stood against a
 * payout in any currency — so a floor of 50 meant fifty dollars, fifty
 * shillings (no floor at all) and fifty dinars (a high bar) at once. A
 * currency the store has named gets its own; the store's own currency keeps
 * the original setting; any other currency has no floor until one is set,
 * because guessing an exchange rate is worse than saying there is none.
 */
export function resolveMinWithdrawal(
  settings: MinWithdrawalSettingsLike,
  currency: string,
): number {
  const code = String(currency || "").trim().toUpperCase();
  const commission = settings?.orders?.commission;
  const byCurrency = commission?.minWithdrawalByCurrency;
  const named =
    byCurrency instanceof Map
      ? byCurrency.get(code)
      : byCurrency
        ? (byCurrency as Record<string, number>)[code]
        : undefined;
  if (typeof named === "number" && Number.isFinite(named) && named >= 0) return named;

  const storeCurrency = String(settings?.general?.defaultCurrency || "USD")
    .trim()
    .toUpperCase();
  if (!code || code === storeCurrency) {
    const amount = Number(commission?.minWithdrawalAmount ?? DEFAULT_MIN_WITHDRAWAL_AMOUNT);
    return Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_MIN_WITHDRAWAL_AMOUNT;
  }
  return 0;
}

export const ORDER_PREFIX_PATTERN = /^[A-Z0-9]{2,10}$/;

export function normalizeOrderPrefix(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  return normalized || DEFAULT_ORDER_PREFIX;
}

