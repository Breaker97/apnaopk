import type { Money } from "@/contracts/mobile/shop/v1/common";
import { resolveCurrency, type Currency } from "@/lib/intl/currencies";
import { formatCurrency, quantizeToCurrency } from "@/lib/intl/money";

/**
 * A price as the contract carries it (`Money`): the amount quantized to the
 * currency's own precision, and the text the app prints.
 *
 * Formatted in the currency's regional locale, with Latin digits, exactly as
 * the website's `formatPrice` does, so one amount never reads two ways on the
 * shopper's two screens.
 *
 * The currency is a code (an order's own, frozen when it was placed) or one
 * already resolved: the store's, which a private route reads with
 * `getStoreCurrency()` (lib/intl/server-currency.ts). A static route must read
 * the store's without that reader's fallback, which its cache would keep as
 * the answer.
 */
export function toMoney(
  amount: number | null | undefined,
  currency: string | Pick<Currency, "code" | "locale">,
): Money {
  const { code, locale } = typeof currency === "string" ? resolveCurrency(currency) : currency;
  const value = quantizeToCurrency(Number(amount ?? 0), code);
  return {
    amount: value,
    currency: code,
    formatted: formatCurrency(value, code, locale),
  };
}
