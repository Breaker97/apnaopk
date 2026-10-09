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

/** The order and shipping settings the bag prices itself with. */
export type CartOrderConfig = {
  taxRate: number;
  /**
   * `orders.freeShippingThreshold` (0 when the store has none), plus the flag
   * that decides whether it means anything. The threshold only reaches the
   * bill on the legacy flat-rate path; see `FreeShippingProgress`.
   */
  freeShippingThreshold: number;
  /** `shipping.enabled` — the store rates by zone instead. */
  zoneShippingEnabled: boolean;
  /** `shipping.delivery.showEstimatedDelivery` — gates the delivery strip. */
  showEstimatedDelivery: boolean;
};

/** What a cart provider holds when no layout handed it the store's. */
export const EMPTY_CART_ORDER_CONFIG: CartOrderConfig = {
  taxRate: 0,
  freeShippingThreshold: 0,
  zoneShippingEnabled: false,
  showEstimatedDelivery: false,
};

type CartOrderSettingsLike = {
  orders?: {
    taxRate?: number | null;
    freeShippingThreshold?: number | null;
  } | null;
  shipping?: {
    enabled?: boolean | null;
    delivery?: { showEstimatedDelivery?: boolean | null } | null;
  } | null;
} | null | undefined;

/**
 * The one reading of these settings: `/api/settings/public` serves it, and
 * the store layouts hand it to the cart provider so the cart page and the
 * drawer price the bag on first render instead of fetching the whole public
 * settings payload for four values.
 */
export function resolveCartOrderConfig(
  settings: CartOrderSettingsLike,
): CartOrderConfig {
  return {
    taxRate: Number(settings?.orders?.taxRate ?? DEFAULT_ORDER_TAX_RATE) || 0,
    freeShippingThreshold:
      Number(
        settings?.orders?.freeShippingThreshold ??
          DEFAULT_FREE_SHIPPING_THRESHOLD,
      ) || 0,
    zoneShippingEnabled: Boolean(settings?.shipping?.enabled),
    showEstimatedDelivery:
      settings?.shipping?.delivery?.showEstimatedDelivery ?? true,
  };
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

