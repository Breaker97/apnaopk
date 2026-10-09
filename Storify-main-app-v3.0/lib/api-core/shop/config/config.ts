import { Config, type AppRelease, type BrandColors } from "@/contracts/mobile/shop/v1/config";
import { localeConfig } from "@/config/i18n.config";
import { defineRoute } from "@/lib/api-core/registry";
import { appBaseUrl } from "@/lib/app-url";
import { getAuthPageSettings } from "@/lib/auth/auth-page-settings";
import { MAX_ALLOWED_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { buildLocalePath } from "@/lib/i18n/locale-prefix";
import { resolveCurrency } from "@/lib/intl/currencies";
import { mobileAppReleaseFor, type MobileShopAppSettings } from "@/lib/settings/mobile-app";
import { readableForegroundColor } from "@/lib/site-config/appearance-colors";
import { getStoreFacts } from "@/lib/storefront/store-facts";
import { imageSet } from "../images";

function release(shop: MobileShopAppSettings, platform: "ios" | "android"): AppRelease {
  const { minVersion, latestVersion, storeUrl } = mobileAppReleaseFor(shop, platform);
  return {
    ...(minVersion ? { minVersion } : {}),
    ...(latestVersion ? { latestVersion } : {}),
    ...(storeUrl ? { storeUrl } : {}),
  };
}

/**
 * The web uses the store's one brand colour in both themes, with the text
 * colour that reads on it (lib/site-config/appearance-colors.ts).
 */
function brandColors(primary: string): BrandColors {
  return { primary, primaryForeground: readableForegroundColor(primary) };
}

/**
 * GET /config: the store as the app needs it before it draws anything. The
 * same for every shopper and changed only by a settings save, so it is a
 * static route: served from the response cache, expired by the settings tag.
 */
export const configRoute = defineRoute({
  id: "config.get",
  method: "GET",
  path: "/config",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: Config,
  handler: async ({ locale, mobileApp }) => {
    // The register page's own flags: the app says "check your email" after
    // sign-up exactly when the website does. Both readers throw on failure.
    const [facts, authPage] = await Promise.all([getStoreFacts(), getAuthPageSettings()]);
    const { storeDefault, enabled } = facts.routing;
    const webPage = (path: string) =>
      `${appBaseUrl()}${buildLocalePath(locale, path, storeDefault)}`;
    const logo = imageSet(facts.logoUrl);
    const logoDark = imageSet(facts.darkLogoUrl);
    const icon = imageSet(facts.iconUrl);
    const brand = brandColors(facts.primaryColor);
    const policy = facts.passwordPolicy;

    return {
      store: {
        name: facts.storeName,
        ...(logo ? { logo } : {}),
        ...(logoDark ? { logoDark } : {}),
        ...(icon ? { icon } : {}),
        websiteUrl: webPage("/"),
      },
      locale: {
        current: locale,
        default: storeDefault,
        languages: enabled.map((code) => ({
          code,
          name: localeConfig[code].name,
          nativeName: localeConfig[code].nativeName,
          direction: localeConfig[code].direction,
        })),
      },
      currency: { code: resolveCurrency(facts.currencyCode).code },
      theme: {
        mode: facts.defaultMode,
        brand: { light: brand, dark: brand },
      },
      features: {
        multiVendor: facts.multiVendor,
        // Neither can be switched off on this store.
        wishlist: true,
        reviews: true,
        guestCheckout: facts.guestCheckout,
        quotes: facts.quotes,
        preOrders: facts.preOrders,
      },
      app: {
        ios: release(mobileApp, "ios"),
        android: release(mobileApp, "android"),
      },
      pages: {
        ...(facts.privacyPageShown ? { privacyPolicyUrl: webPage("/privacy") } : {}),
        ...(facts.termsPageShown ? { termsUrl: webPage("/terms") } : {}),
        accountDeletionUrl: webPage("/account-deletion"),
      },
      auth: {
        passwordPolicy: {
          minLength: policy.minPasswordLength,
          maxLength: MAX_ALLOWED_PASSWORD_LENGTH,
          requireUppercase: policy.requireUppercase,
          requireNumber: policy.requireNumbers,
          requireSpecialCharacter: policy.requireSpecialChars,
        },
        emailVerificationRequired: authPage.emailVerificationRequired,
        // The client ID only, which is public; never the secret.
        ...(authPage.googleClientId
          ? { google: { webClientId: authPage.googleClientId } }
          : {}),
      },
    };
  },
});
