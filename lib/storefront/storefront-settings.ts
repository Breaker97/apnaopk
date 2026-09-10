import { unstable_cache } from "next/cache";
import { appConfig } from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { DEFAULT_LANGUAGE } from "@/config/branding.config";
import { normalizeContentPagesSettings } from "@/lib/site-config/content-pages-config";
import { connectDB } from "@/lib/db";
import { normalizeCheckoutSettings } from "@/lib/checkout/checkout-config";
import { normalizeFooterSettings } from "@/lib/site-config/footer-config";
import { normalizeHeaderSettings } from "@/lib/site-config/header-config";
import { resolveActiveTheme } from "@/lib/storefront/themes/registry";
import { resolveStoredProductCardConfig } from "@/lib/storefront/themes/product-card";
import { resolveBrand } from "@/lib/branding/brand";
import { resolveAnalyticsConfig } from "@/lib/settings/credentials";
import { getSettings } from "@/models/settings.model";

export const getStorefrontSettings = unstable_cache(
  async () => {
    await connectDB();
    const settings = await getSettings();
    const analytics = settings.analytics;
    const resolvedAnalytics = resolveAnalyticsConfig(analytics);
    const general = settings.general;
    const social = settings.social;

    return {
      analytics: {
        googleAnalyticsId: resolvedAnalytics.googleAnalyticsId,
        googleTagManagerId: resolvedAnalytics.googleTagManagerId,
        facebookPixelId: resolvedAnalytics.facebookPixelId,
        tiktokPixelId: resolvedAnalytics.tiktokPixelId,
        plausibleBaseUrl: analytics?.plausibleBaseUrl || undefined,
        plausibleDomain: analytics?.plausibleDomain || undefined,
        plausibleSelfHosted: Boolean(analytics?.plausibleSelfHosted),
      },
      checkoutSettings: normalizeCheckoutSettings(settings.checkout),
      /** Store-wide product card configuration (order, visibility, style). */
      productCardConfig: resolveStoredProductCardConfig(
        settings.productCard,
        settings.onlineStore?.activeTheme,
      ),
      contentPages: normalizeContentPagesSettings(settings.contentPages),
      footerSettings: normalizeFooterSettings(settings.footer),
      headerSettings: normalizeHeaderSettings(settings.header),
      // The home page's section list is NOT here: it lives in the theme
      // engine's own cached fetcher (lib/storefront/pages/get-home-page.ts).
      /** Fallback locale for translatable section content (`lt()`). */
      defaultLanguage: general?.defaultLanguage?.trim() || DEFAULT_LANGUAGE,
      /** Active theme id, its tokens, and the legacy flat settings view. */
      theme: resolveActiveTheme(settings.onlineStore),
      /** The store's brand (assets, palette, default mode) as one object. */
      brand: resolveBrand(settings),
      isMultiVendorEnabled: Boolean(settings.multiVendorMode?.enabled),
      /**
       * Whether cash on delivery is switched on.
       *
       * Read by the storefront because collection is cash-at-the-counter only:
       * `checkout-content` gates the whole pickup option on this flag, so with
       * COD off there is no way to complete a collected order — and a discovery
       * facet offering "pickup near me" would be advertising a checkout path
       * that does not exist.
       */
      codEnabled: settings.payment?.cod?.enabled ?? true,
      storeName: general?.storeName?.trim() || appConfig.name,
      storeDescription: general?.storeDescription?.trim() || "",
      storeEmail: general?.storeEmail?.trim() || "",
      storePhone: general?.storePhone?.trim() || "",
      storeAddress: general?.storeAddress?.trim() || "",
      logoUrl: general?.logoUrl?.trim() || "",
      darkModeLogoUrl: general?.darkModeLogoUrl?.trim() || "",
      social: {
        facebookUrl: social?.facebookUrl,
        twitterUrl: social?.twitterUrl,
        instagramUrl: social?.instagramUrl,
        youtubeUrl: social?.youtubeUrl,
        linkedinUrl: social?.linkedinUrl,
        tiktokUrl: social?.tiktokUrl,
      },
    };
  },
  ["storefront-settings"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.settings],
  },
);
