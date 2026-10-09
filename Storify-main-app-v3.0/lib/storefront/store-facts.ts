import { unstable_cache } from "next/cache";
import { appConfig } from "@/config/app.config";
import { DEFAULT_CURRENCY, type ThemeMode } from "@/config/branding.config";
import { normalizePasswordPolicy, type PasswordPolicy } from "@/lib/auth/password-policy";
import { brandIconUrl, resolveBrand } from "@/lib/branding/brand";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { normalizeCheckoutSettings } from "@/lib/checkout/checkout-config";
import { connectDB } from "@/lib/db";
import { resolveLocaleRouting, type LocaleRouting } from "@/lib/i18n/locale-prefix";
import { resolveProductFeatures } from "@/lib/products/product-features";
import { normalizeContentPagesSettings } from "@/lib/site-config/content-pages-config";
import { getSettingsLean } from "@/models/settings.model";

/**
 * The store-wide facts an answer cached as a whole needs: who the store is
 * (name, logo, brand colour), how it sells (currency, languages, guest
 * checkout, several sellers or one) and the rules a shopper meets before they
 * send anything (the password policy).
 */
export type StoreFacts = {
  storeName: string;
  logoUrl: string;
  darkLogoUrl: string;
  /**
   * The square mark: the installed-app icon, else the favicon (the order the
   * storefront's own icons use, lib/storefront/storefront-metadata.ts). Empty
   * when the store set neither; never the wide logo.
   */
  iconUrl: string;
  currencyCode: string;
  routing: LocaleRouting;
  primaryColor: string;
  defaultMode: ThemeMode;
  multiVendor: boolean;
  guestCheckout: boolean;
  /** Products may be sold by quote (Settings → Products, "Price on request"). */
  quotes: boolean;
  /** Products may open a pre-order (Settings → Products). */
  preOrders: boolean;
  privacyPageShown: boolean;
  termsPageShown: boolean;
  passwordPolicy: PasswordPolicy;
};

async function readStoreFacts(): Promise<StoreFacts> {
  await connectDB();
  const settings = await getSettingsLean();
  const general = settings.general;
  const brand = resolveBrand(settings);
  const pages = normalizeContentPagesSettings(settings.contentPages);
  const productFeatures = resolveProductFeatures(settings);
  return {
    storeName: general?.storeName?.trim() || appConfig.name,
    logoUrl: brand.assets.logoUrl,
    darkLogoUrl: brand.assets.darkLogoUrl,
    iconUrl: brandIconUrl(brand.assets),
    currencyCode: general?.defaultCurrency || DEFAULT_CURRENCY,
    routing: resolveLocaleRouting(general),
    primaryColor: brand.colors.primary,
    defaultMode: brand.defaultMode,
    multiVendor: Boolean(settings.multiVendorMode?.enabled),
    guestCheckout: normalizeCheckoutSettings(settings.checkout).accounts.guestCheckout,
    quotes: productFeatures.priceOnRequest,
    preOrders: productFeatures.preorders,
    privacyPageShown: pages.privacy.visible,
    termsPageShown: pages.terms.visible,
    passwordPolicy: normalizePasswordPolicy(settings.security),
  };
}

/**
 * The store's facts from one read of the settings, cached for the whole
 * server on the settings tag, so a save is seen by the next request.
 *
 * A failed read throws. These are for answers that are cached as they are (a
 * static mobile route), where the usual storefront fallbacks ("Storify",
 * USD, English only) would be stored as the store's own answer; see
 * lib/storefront/cached-read.ts.
 */
export const getStoreFacts = unstable_cache(readStoreFacts, ["store-facts"], {
  revalidate: 60,
  tags: [CACHE_TAGS.settings],
});
