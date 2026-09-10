"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { formatCurrency } from "@/lib/intl/money";
import { CURRENCIES, resolveCurrency, type Currency } from "@/lib/intl/currencies";

/**
 * Currency Configuration
 *
 * Display metadata for the currencies the admin can pick as the store default
 * lives in `@/lib/intl/currencies` so server components can resolve the same symbol
 * and locale. The store-wide currency is admin-controlled only (settings.general
 * .defaultCurrency) — customers cannot choose a display currency, so there is
 * no client-side persistence and no conversion: prices are stored and shown in
 * the store currency as-is.
 */

interface CurrencyState {
  currency: Currency;
  setCurrency: (code: string) => void;
  formatPrice: (price: number) => string;
}

/**
 * Currency Store with Zustand
 *
 * Mirrors the admin-configured default currency. Written only by
 * <CurrencyApplier> (on load / settings refresh) and the admin settings save
 * flow — never by customer-facing UI. Not persisted: the authoritative value
 * comes from the server on every load, so caching a copy in localStorage can
 * only ever serve a stale currency.
 */
export const useCurrencyStore = create<CurrencyState>()((set, get) => ({
  currency: CURRENCIES[0],

  setCurrency: (code: string) => {
    const currency = resolveCurrency(code);
    set((state) =>
      state.currency.code === currency.code ? state : { currency },
    );
  },

  // Decimal places are left to Intl, which knows the ISO 4217 minor units of
  // every currency (JPY 0, KWD 3, USD 2) — including codes an admin adds that
  // aren't in CURRENCIES.
  formatPrice: (price: number) => {
    const { currency } = get();
    return formatCurrency(price, currency.code, currency.locale);
  },
}));

/**
 * Hook to access the store currency and price formatter.
 *
 * Subscribes to the whole store so consumers that only destructure
 * `formatPrice` still re-render when the currency changes.
 */
export function useCurrency() {
  const { currency, setCurrency, formatPrice } = useCurrencyStore();

  return {
    currency,
    currencies: CURRENCIES,
    setCurrency,
    formatPrice,
  };
}

/**
 * Price formatter pinned to an explicit currency code.
 *
 * Boost purchases freeze the currency they were priced/charged in, so a
 * historical row must be formatted with THAT code — formatting it with the
 * store's current default silently relabels every past amount the moment an
 * admin switches the store currency. Falls back to the store formatter when no
 * code is given (legacy rows written before the field).
 */
export function useCurrencyFormatter(currencyCode?: string | null) {
  const { formatPrice } = useCurrency();

  return useMemo(() => {
    const normalized = String(currencyCode || "").toUpperCase();
    if (!normalized) return formatPrice;

    const currency = resolveCurrency(normalized);
    return (price: number) =>
      formatCurrency(price, currency.code, currency.locale);
  }, [currencyCode, formatPrice]);
}
