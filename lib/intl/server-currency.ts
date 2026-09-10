import "server-only";

import { unstable_cache } from "next/cache";
import { DEFAULT_CURRENCY } from "@/config/branding.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { resolveCurrency, type Currency } from "@/lib/intl/currencies";
import { formatCurrency } from "@/lib/intl/money";
import { getSettingsLean } from "@/models/settings.model";

/**
 * The configured currency code, cached under the settings tag like every
 * other storefront settings reader. Currency is admin-only by design, so it
 * changes exactly when an admin saves settings — which revalidates the tag.
 * Before this the home page's coupon banner paid one uncached settings round
 * trip per render for a three-letter code.
 */
const loadStoreCurrencyCode = unstable_cache(
  async (): Promise<string> => {
    await connectDB();
    const settings = await getSettingsLean();
    return settings?.general?.defaultCurrency || DEFAULT_CURRENCY;
  },
  ["store-currency"],
  { revalidate: 60, tags: [CACHE_TAGS.settings] },
);

/**
 * Store currency for server components and route handlers.
 *
 * The client mirrors `settings.general.defaultCurrency` through
 * `<CurrencyApplier>` into the zustand currency store, but server-rendered
 * surfaces (stats strips, list pages) have no access to that store. Reading the
 * same setting here is what keeps a server-rendered total and the client-rendered
 * row beneath it from disagreeing about the currency.
 */
export async function getStoreCurrency(): Promise<Currency> {
  try {
    return resolveCurrency(await loadStoreCurrencyCode());
  } catch {
    // A settings read failure must not blank out an entire page — fall back to
    // the configured default rather than throwing out of a stats strip.
    return resolveCurrency(DEFAULT_CURRENCY);
  }
}

/**
 * Money formatter bound to the store currency.
 *
 * Formatting uses the *currency's* regional locale (BDT → bn-BD) rather than
 * the visitor's UI locale, matching `useCurrency().formatPrice` on the client
 * so the same amount never renders two different ways on one page.
 */
export async function getStoreMoneyFormatter(): Promise<
  (value: number) => string
> {
  const currency = await getStoreCurrency();
  return (value: number) =>
    formatCurrency(value, currency.code, currency.locale);
}
