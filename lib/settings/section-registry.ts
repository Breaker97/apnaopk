import { z } from "zod";
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
    "supportedCurrencies",
    "countryAvailability",
    "timezone",
    "productSearchMode",
  ] as const),
  appearance: section([
    "primaryColor",
    "secondaryColor",
    "accentColor",
    "theme",
    "contrast",
    "rtl",
    "collapsedSidebar",
    "navLayout",
    "navColor",
    "presetColor",
    "customPresets",
    "fontFamily",
    "borderRadius",
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
  ] as const),
  email: section([
    "provider",
    "enabled",
    "smtp",
    "fromEmail",
    "fromName",
    "replyTo",
    "apiKey",
    "logRetentionDays",
  ] as const),
  orders: section([
    "prefix",
    "taxRate",
    "freeShippingThreshold",
    "defaultShippingCost",
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
    "courierTrackingLinks",
  ] as const),
  // No `robotsTxt`: it had a schema field and an allow-list entry but no field
  // in the SEO tab and no reader — `app/robots.ts` builds its rules from
  // constants. Left as free text it is also a loaded gun: one stray
  // `Disallow: /` de-indexes the whole store.
  seo: section(["metaTitle", "metaDescription", "metaKeywords", "ogImage"] as const),
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
    "language",
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
  vendorConfig: section([
    "plansEnabled",
    "allowRegistration",
    "autoApprove",
    "freeTrialDays",
    "requirePlanSelection",
    "requiredDocuments",
    "defaultPlanId",
    "paymentMethods",
  ] as const),
  // Typed rather than `unknown`: `findOneAndUpdate` runs no Mongoose
  // validators, so the schema's `enum` would not stop an unrecognised value
  // being written — and the storefront reader normalises anything it does
  // not recognise back to "show", which would present as the switch silently
  // refusing to hold its setting.
  catalog: z.object({
    outOfStockDisplay: z.enum(OUT_OF_STOCK_DISPLAY_VALUES).optional(),
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
  checkout: section(["layout", "trust", "policyLinks"] as const),
  productCard: section(
    ["template", "groups", "visibility", "action", "style"] as const,
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

/** The keys a section accepts, for callers that still want a list. */
export function allowedSectionKeys(section: SettingsSectionKey): string[] {
  return Object.keys(SETTINGS_SECTION_SCHEMAS[section].shape);
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
