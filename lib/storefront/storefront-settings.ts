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
import {
  normalizeAISalesAgentSettings,
  toPublicAISalesAgentConfig,
} from "@/lib/ai-sales-agent/settings";
import { resolveAddressHoldSettings } from "@/lib/orders/address-hold-policy";
import { resolveCartOrderConfig } from "@/lib/orders/order-settings";
import { resolveShareSettings } from "@/lib/site-config/share-config";
import { getSettings } from "@/models/settings.model";
import { resolveReturnPolicy } from "@/lib/returns/return-policy";

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
      /**
       * The return window new orders are sold with, in days — what
       * `{windowDays}` stands for in page copy, so a policy page can never
       * promise a window the store does not enforce.
       */
      returnWindowDays: resolveReturnPolicy(settings).windowDays,
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
       * The sales assistant widget's public configuration (on/off, name,
       * greeting, colours, capabilities — never the API key). The store
       * layout hands it to the widget as a prop; it rides this read rather
       * than getting a cached getter of its own because each getter costs
       * a settings round trip on a cold cache.
       */
      aiSalesAgent: toPublicAISalesAgentConfig(
        normalizeAISalesAgentSettings(settings.aiSalesAgent),
        {
          faviconUrl: general?.faviconUrl,
          aiAuthoring: settings.aiAuthoring,
        },
      ),
      /** Tax, free-shipping and delivery-estimate settings for the bag. */
      cartOrderConfig: resolveCartOrderConfig(settings),
      /**
       * Whether checkout asks a courier about the delivery address ("did you
       * mean…"). Off, the page does not ask the server at all.
       */
      addressCheckAtCheckout: resolveAddressHoldSettings(
        settings.shipping?.addressHold,
      ).suggestAtCheckout,
      storeName: general?.storeName?.trim() || appConfig.name,
      storeDescription: general?.storeDescription?.trim() || "",
      storeEmail: general?.storeEmail?.trim() || "",
      storePhone: general?.storePhone?.trim() || "",
      storeAddress: general?.storeAddress?.trim() || "",
      logoUrl: general?.logoUrl?.trim() || "",
      darkModeLogoUrl: general?.darkModeLogoUrl?.trim() || "",
      /** Which share buttons a product page offers (Settings → Social). */
      shareSettings: resolveShareSettings(social?.share),
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
