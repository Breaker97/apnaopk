import * as z from "zod";
import { ValidationError } from "@/lib/api/errors";
import { OUT_OF_STOCK_DISPLAY_VALUES } from "@/lib/catalog/catalog-display";
import { CONTENT_PAGE_KEYS } from "@/lib/site-config/content-pages-config";
import {
  credentialPathsForSection,
  deleteCredentialPath,
  readCredentialPath,
  setCredentialPath,
} from "@/lib/settings/credential-fields";

/**
 * The settings sections an admin may write, and the keys each accepts.
 *
 * One zod object per section is the single source the PUT route validates
 * against, the sanitiser lists sections from, and the client type mirrors.
 * Keys are `unknown` at this level on purpose: the per-section validators and
 * the Mongoose schema decide values, this decides *shape* — an unknown key is
 * dropped (never rejected, so a stale browser tab posting an old field is
 * ignored), a non-object payload is refused. Tighten a key to a real type
 * here when its validator moves out of the route.
 */
function section<const K extends readonly string[]>(keys: K) {
  return z.object(
    Object.fromEntries(keys.map((key) => [key, z.unknown().optional()])) as {
      [Key in K[number]]: z.ZodOptional<z.ZodUnknown>;
    },
  );
}

export const SETTINGS_SECTION_SCHEMAS = {
  general: section([
    "storeName",
    "storeDescription",
    "storeEmail",
    "storePhone",
    "storeDomain",
    "storeAddress",
    "logoUrl",
    "darkModeLogoUrl",
    "faviconUrl",
    "appIconUrl",
    "defaultLanguage",
    "defaultCurrency",
    "supportedLanguages",
    "countryAvailability",
  ] as const),
  appearance: section([
    "primaryColor",
    "secondaryColor",
    "accentColor",
    "skeletonColor",
    "theme",
    "presetColor",
    "customPresets",
  ] as const),
  payment: section([
    "stripe",
    "paypal",
    "razorpay",
    "paystack",
    "pesapal",
    "iotec",
    "orange_money",
    "mtn_momo",
    "cod",
    // The human check behind the card-testing guard (`lib/checkout/turnstile.ts`).
    // `attemptGateways` is deliberately absent: it is an operator's rollout
    // switch, set in the database, not a store setting.
    "turnstile",
  ] as const),
  email: section([
    "enabled",
    "smtp",
    "fromEmail",
    "fromName",
    "replyTo",
    "logRetentionDays",
  ] as const),
  sms: section([
    "enabled",
    "twilio",
    "defaultCountry",
    "includeLinks",
    "logRetentionDays",
  ] as const),
  orders: section([
    "prefix",
    "taxRate",
    "freeShippingThreshold",
    "defaultShippingCost",
    "loyaltySpendPerPoint",
    "commission",
    "returns",
  ] as const),
  shipping: section([
    "enabled",
    "weightUnit",
    "origin",
    "delivery",
    "zones",
    "fallbackRate",
    "customs",
    "vendorShipping",
    "codCollectedBy",
    "carriers",
    "packages",
    "automation",
    "addressHold",
    "courierTrackingLinks",
  ] as const),
  // No `robotsTxt`: it had a schema field and an allow-list entry but no field
  // in the SEO tab and no reader — `app/robots.ts` builds its rules from
  // constants. Left as free text it is also a loaded gun: one stray
  // `Disallow: /` de-indexes the whole store.
  seo: section(["metaTitle", "metaDescription", "metaKeywords", "ogImage"] as const),
  /** Saved slide templates (Online Store → Sliders → save as template). */
  sliderTemplates: section(["items"] as const),
  social: section([
    "facebookUrl",
    "twitterUrl",
    "instagramUrl",
    "youtubeUrl",
    "linkedinUrl",
    "tiktokUrl",
    "share",
  ] as const),
  analytics: section([
    "googleAnalyticsId",
    "googleTagManagerId",
    "facebookPixelId",
    "tiktokPixelId",
    "plausibleDomain",
    "plausibleApiKey",
    "plausibleSelfHosted",
    "plausibleBaseUrl",
  ] as const),
  maintenance: section([
    "enabled",
    "title",
    "message",
    "backgroundImageUrl",
    "countdownEnabled",
    "countdownEndsAt",
    "allowedIPs",
  ] as const),
  security: section([
    "emailVerificationRequired",
    "emailVerificationForVendors",
    "twoFactorEnabled",
    "twoFactorRequiredForAdmin",
    "twoFactorRequiredForVendors",
    "twoFactorRequiredForStaff",
    "googleOAuthEnabled",
    "googleClientId",
    "googleClientSecret",
    "facebookOAuthEnabled",
    "facebookAppId",
    "facebookAppSecret",
    "sessionMaxAgeDays",
    "maxLoginAttempts",
    "lockoutDurationMinutes",
    "rateLimiting",
    "minPasswordLength",
    "requireUppercase",
    "requireNumbers",
    "requireSpecialChars",
  ] as const),
  pos: section([
    "enabled",
    "allowAdminSales",
    "allowVendorSales",
    "allowSellerSales",
    "defaultPosLocationId",
    "customize",
    "checkout",
    "orders",
  ] as const),
  multiVendorMode: section([
    "enabled",
    "canManageProducts",
    "canViewOrders",
    "canManageOrders",
    "canManageStoreSettings",
    "canViewAnalytics",
    "canManageDiscounts",
    "canManagePayouts",
    "canAccessPOS",
    "packPolicy",
  ] as const),
  preorder: section([
    "enabled",
    "requireVendorApproval",
    "maxLeadDays",
    "maxDepositPercent",
    "expiryGraceDays",
    "autoRelease",
    "autoReleaseDelayDays",
    "balanceChargeNoticeHours",
    "reservePercent",
    "reserveDays",
  ] as const),
  vendorConfig: section([
    "plansEnabled",
    "allowRegistration",
    "requirePlanSelection",
    "requiredDocuments",
    "defaultPlanId",
    "paymentMethods",
    "showQuoteContactToVendors",
    "showAbandonedCheckoutsToVendors",
    "abandonedOffers",
  ] as const),
  // Typed rather than `unknown`: `findOneAndUpdate` runs no Mongoose
  // validators, so the schema's `enum` would not stop an unrecognised value
  // being written — and the storefront reader normalises anything it does
  // not recognise back to "show", which would present as the switch silently
  // refusing to hold its setting.
  // The product features are typed for the same reason: a string "false"
  // would be truthy, and read back as a switch that will not turn off.
  catalog: z.object({
    outOfStockDisplay: z.enum(OUT_OF_STOCK_DISPLAY_VALUES).optional(),
    physicalProducts: z.boolean().optional(),
    digitalProducts: z.boolean().optional(),
    priceOnRequest: z.boolean().optional(),
  }),
  // Typed for the catalog's reason: the route writes with `set()` and runs no
  // Mongoose validators, and a string "false" would switch an API on.
  // Formats are checked by validateMobileAppSettings (lib/settings/mobile-app.ts).
  mobileApp: z.object({
    shop: z
      .object({
        enabled: z.boolean().optional(),
        scheme: z.string().optional(),
        ios: z
          .object({
            bundleId: z.string().optional(),
            teamId: z.string().optional(),
            appStoreUrl: z.string().optional(),
            minVersion: z.string().optional(),
            latestVersion: z.string().optional(),
          })
          .optional(),
        android: z
          .object({
            packageName: z.string().optional(),
            sha256CertFingerprints: z.array(z.string()).optional(),
            playStoreUrl: z.string().optional(),
            minVersion: z.string().optional(),
            latestVersion: z.string().optional(),
          })
          .optional(),
        allowDigitalPurchases: z.boolean().optional(),
        // A credential: "" keeps the stored token, null removes it
        // (applyCredentialUpdateMarkers).
        expoAccessToken: z.string().nullable().optional(),
      })
      .optional(),
    // The business app: no link files and no push token of its own (push
    // goes out with the one token above).
    biz: z
      .object({
        enabled: z.boolean().optional(),
        scheme: z.string().optional(),
        ios: z
          .object({
            bundleId: z.string().optional(),
            appStoreUrl: z.string().optional(),
            minVersion: z.string().optional(),
            latestVersion: z.string().optional(),
          })
          .optional(),
        android: z
          .object({
            packageName: z.string().optional(),
            playStoreUrl: z.string().optional(),
            minVersion: z.string().optional(),
            latestVersion: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  }),
  boosting: section([
    "enabled",
    "paymentMethods",
    "placements",
    "listingSlots",
    "productPageSlots",
    "hideOutOfStock",
    "holdMinutes",
    "bookingHorizonDays",
    "maxBookingDays",
  ] as const),
  notifications: section(["admin", "staff", "vendor", "customer"] as const),
  // The deprecated flat credential keys (accountId, endpoint, region,
  // bucketName, accessKeyId, secretAccessKey, publicUrl) are deliberately
  // absent: credentials now live under "r2"/"s3" and nothing may write back to
  // the old location. Unknown keys are dropped, so a stale browser tab posting
  // the old shape is ignored rather than rejected.
  storage: section([
    "provider",
    "r2",
    "s3",
    "minio",
    "digitalocean",
    "maxFileSizeMB",
    "maxImageSizeMB",
    "maxVideoSizeMB",
    "maxModelSizeMB",
    "allowedMimeTypes",
    "pathPrefix",
  ] as const),
  aiSalesAgent: section([
    "enabled",
    "model",
    "temperature",
    "reasoningEffort",
    "maxRecommendations",
    "monthlyTokenBudget",
    "agentName",
    "greeting",
    "tone",
    "instructions",
    "escalationMessage",
    "widget",
    "capabilities",
  ] as const),
  // The brand kit is edited on the AI tab and read by both social-export
  // routes; leaving it off this list discarded the colours and logo while
  // the tab reported success.
  aiAuthoring: section([
    "enabled",
    "apiKey",
    "textModel",
    "imageModel",
    "surfaces",
    "imageDefaults",
    "brandVoice",
    "brandKit",
    "access",
    "limits",
  ] as const),
  header: section([
    "builder",
    "layout",
    "brand",
    "colors",
    "search",
    "market",
    "mobile",
    "widgets",
    "categoryMenu",
    "collectionsMenu",
    "utilityMenu",
    "pagesMenu",
  ] as const),
  footer: section([
    // The footer AS A LAYOUT, as `header` keeps its own above. It must be
    // listed: the route REPLACES the whole footer object with the
    // normalizer's output (app/api/admin/settings/route.ts), so a key the
    // allow-list strips is not merely unsaved, it is erased from a document
    // that already had it — a merchant who built a layout and then saved
    // anything from the footer form would lose it, with a 200 back.
    "builder",
    "layout",
    "brand",
    "colors",
    "widgets",
    "contact",
    "social",
    "linkColumns",
    "copyright",
    "paymentMethods",
  ] as const),
  checkout: section(
    [
      "layout",
      "trust",
      "policyLinks",
      "contact",
      "fields",
      "orderNote",
      "customFields",
      "accounts",
      "abandonedCheckouts",
    ] as const,
  ),
  // `version` must survive the allow-list: without it every save reads
  // back as a pre-v2 card, whose "brand" element is renamed to "seller".
  productCard: section(
    ["version", "template", "groups", "visibility", "action", "style"] as const,
  ),
  homePage: section(["sectionOrder", "sections"] as const),
  // Every built-in page (terms, privacy, …, about) plus the custom list. The
  // page editors each PUT `{ section: "contentPages", data: { about } }`, so
  // a key missing here does not fail the save — zod strips it and the route
  // reports success over an unchanged document.
  contentPages: section([...CONTENT_PAGE_KEYS, "customPages"] as const),
} as const;

type SettingsSectionKey = keyof typeof SETTINGS_SECTION_SCHEMAS;

export const SETTINGS_SECTION_KEYS = Object.keys(
  SETTINGS_SECTION_SCHEMAS,
) as SettingsSectionKey[];

export function isSettingsSection(value: unknown): value is SettingsSectionKey {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SETTINGS_SECTION_SCHEMAS, value)
  );
}

/**
 * Applies a section's shape to an incoming payload: refuses anything that is
 * not an object, drops keys the section does not know, returns a fresh object
 * (the caller's payload is never mutated).
 */
export function applySectionAllowList(
  section: string,
  data: unknown,
): Record<string, unknown> {
  if (!isSettingsSection(section)) {
    throw new ValidationError(`Invalid section: ${section}`);
  }
  const parsed = SETTINGS_SECTION_SCHEMAS[section].safeParse(data);
  if (!parsed.success) {
    throw new ValidationError(`Invalid payload for section "${section}"`);
  }
  return parsed.data as Record<string, unknown>;
}

/**
 * How the admin form talks about secrets it never receives back: an empty
 * string means "leave the stored value alone" (the key is removed from the
 * update), `null` means "clear it" (the key stays, set to `undefined`, which
 * the dot-path writer turns into an unset). Anything else is a new value.
 */
export function applyCredentialUpdateMarkers(
  section: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  for (const path of credentialPathsForSection(section)) {
    const value = readCredentialPath(data, path);
    if (value === "") deleteCredentialPath(data, path);
    else if (value === null) setCredentialPath(data, path, undefined);
  }
  return data;
}
