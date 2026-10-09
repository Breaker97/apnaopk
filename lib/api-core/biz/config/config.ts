import { Config, type AppRelease, type BrandColors } from "@/contracts/mobile/biz/v1/config";
import { localeConfig } from "@/config/i18n.config";
import { defineBizRoute } from "@/lib/api-core/registry";
import { imageSet } from "@/lib/api-core/shop/images";
import { appBaseUrl } from "@/lib/app-url";
import { MAX_ALLOWED_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { buildLoginUrl } from "@/lib/auth/return-path";
import { buildLocalePath } from "@/lib/i18n/locale-prefix";
import { resolveCurrency } from "@/lib/intl/currencies";
import { mobileAppReleaseFor, type MobileBizAppSettings } from "@/lib/settings/mobile-app";
import { readableForegroundColor } from "@/lib/site-config/appearance-colors";
import { getStoreFacts } from "@/lib/storefront/store-facts";

function release(app: MobileBizAppSettings, platform: "ios" | "android"): AppRelease {
  const { minVersion, latestVersion, storeUrl } = mobileAppReleaseFor(app, platform);
  return {
    ...(minVersion ? { minVersion } : {}),
    ...(latestVersion ? { latestVersion } : {}),
    ...(storeUrl ? { storeUrl } : {}),
  };
}

/** The store's one brand colour in both themes, with the text colour that reads on it. */
function brandColors(primary: string): BrandColors {
  return { primary, primaryForeground: readableForegroundColor(primary) };
}

/**
 * GET /config: the store as the business app needs it before anybody signs
 * in. The same for everybody and changed only by a settings save, so it is a
 * static route: served from the response cache, expired by the settings tag
 * (the store facts' and the runtime read's).
 */
export const bizConfigRoute = defineBizRoute({
  id: "config.get",
  method: "GET",
  path: "/config",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: Config,
  handler: async ({ locale, mobileApp }) => {
    const facts = await getStoreFacts();
    const { storeDefault, enabled } = facts.routing;
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
        websiteUrl: `${appBaseUrl()}${buildLocalePath(locale, "/", storeDefault)}`,
        dashboardUrl: `${appBaseUrl()}${buildLoginUrl(locale)}`,
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
      features: { multiVendor: facts.multiVendor },
      app: {
        ios: release(mobileApp, "ios"),
        android: release(mobileApp, "android"),
      },
      auth: {
        passwordPolicy: {
          minLength: policy.minPasswordLength,
          maxLength: MAX_ALLOWED_PASSWORD_LENGTH,
          requireUppercase: policy.requireUppercase,
          requireNumber: policy.requireNumbers,
          requireSpecialCharacter: policy.requireSpecialChars,
        },
      },
    };
  },
});
