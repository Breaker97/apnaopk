"use client";

import { useEffect, useState } from "react";
import { useAppSettings } from "@/providers/app-settings-provider";
import { useCurrencyStore } from "@/providers/currency-provider";

function normalizeCurrencyCode(code: string | undefined) {
  return String(code || "USD").toUpperCase();
}

function applyCurrency(code: string) {
  const store = useCurrencyStore.getState();
  if (store.currency.code !== code) {
    store.setCurrency(code);
  }
}

/**
 * Currency Applier
 *
 * Applies the admin-configured default currency
 * (settings.general.defaultCurrency) to the currency store. This is the ONLY
 * runtime source of the store currency — customers have no currency picker —
 * so the store must always mirror admin settings.
 */
export function CurrencyApplier() {
  const { defaultCurrency, isLoading } = useAppSettings();

  // Seed the store during the first render, before {children} of
  // <AppProviders> mount, so SSR output and the hydration pass both format
  // prices in the configured currency — no USD flash, no hydration mismatch.
  // useState's initializer is the render-phase slot that runs once per mount;
  // no component is subscribed to the store yet, and applyCurrency no-ops
  // when the code already matches, so StrictMode's double invoke is harmless.
  useState(() => {
    if (!isLoading) {
      applyCurrency(normalizeCurrencyCode(defaultCurrency));
    }
    return null;
  });

  useEffect(() => {
    if (isLoading) return;
    // Compare against live store state (inside applyCurrency), not a value
    // captured at render time — a stale snapshot here is what previously let
    // the sync conclude "already applied" and strand the store on a currency
    // persisted by the removed customer-facing switcher.
    applyCurrency(normalizeCurrencyCode(defaultCurrency));
  }, [defaultCurrency, isLoading]);

  return null;
}
