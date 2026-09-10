export const DEFAULT_ORDER_PREFIX = "ORD";
export const DEFAULT_ORDER_TAX_RATE = 0;
export const DEFAULT_ORDER_SHIPPING_COST = 5;
export const DEFAULT_FREE_SHIPPING_THRESHOLD = 0;
export const DEFAULT_VENDOR_COMMISSION_RATE = 10;
export const DEFAULT_MIN_WITHDRAWAL_AMOUNT = 50;

export const ORDER_PREFIX_PATTERN = /^[A-Z0-9]{2,10}$/;

export function normalizeOrderPrefix(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  return normalized || DEFAULT_ORDER_PREFIX;
}

