import { ValidationError } from "@/lib/api/errors";
import { isPlainObject } from "@/lib/utils";

/**
 * Settings → Mobile app: the store's apps and the API they read.
 *
 * Stored as `mobileApp: { shop, biz }`. `shop` is the shopper app and the API
 * under `/api/mobile/shop/v1`; `biz` is the business app (the store's
 * operators) and the API under `/api/mobile/biz/v1`. Each has its own switch,
 * link scheme and versions; the two schemes must differ, since a session's
 * audience is told by its scheme (lib/auth/session-audience.ts). Everything is
 * off by default: a store that never opens this screen serves no mobile API
 * at all.
 *
 * Reads go through `resolveMobileAppSettings`, which fills the defaults a
 * lean read of an older document does not carry and never returns the Expo
 * access token: the resolved settings are cached for every request, and a
 * credential has no business in a cache. The token is read where a push is
 * sent, through `resolveExpoAccessToken` (lib/settings/credentials.ts).
 */

export type AppPlatform = "ios" | "android";

const APP_PLATFORMS: readonly AppPlatform[] = ["ios", "android"];

export interface MobileShopAppSettings {
  /** Whether `/api/mobile/shop/*` answers at all. */
  enabled: boolean;
  /** The URL scheme the app was built with ("mystore" for mystore://), or "". */
  scheme: string;
  ios: {
    bundleId?: string;
    teamId?: string;
    appStoreUrl?: string;
    minVersion?: string;
    latestVersion?: string;
  };
  android: {
    packageName?: string;
    sha256CertFingerprints: string[];
    playStoreUrl?: string;
    minVersion?: string;
    latestVersion?: string;
  };
  /** App stores bill digital goods themselves; off unless the store opts in. */
  allowDigitalPurchases: boolean;
}

export interface MobileBizAppSettings {
  /** Whether `/api/mobile/biz/*` answers at all. */
  enabled: boolean;
  /** The URL scheme the business app was built with, or "". Never the shop's. */
  scheme: string;
  ios: {
    bundleId?: string;
    appStoreUrl?: string;
    minVersion?: string;
    latestVersion?: string;
  };
  android: {
    packageName?: string;
    playStoreUrl?: string;
    minVersion?: string;
    latestVersion?: string;
  };
}

export interface MobileAppSettings {
  shop: MobileShopAppSettings;
  biz: MobileBizAppSettings;
}

/** What an app's versions and store listings are read from (either app). */
interface AppReleaseSettings {
  ios: { appStoreUrl?: string; minVersion?: string; latestVersion?: string };
  android: { playStoreUrl?: string; minVersion?: string; latestVersion?: string };
}

/** One platform's versions and listing, as the app compares itself to them. */
interface MobileAppRelease {
  minVersion?: string;
  latestVersion?: string;
  storeUrl?: string;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The store's mobile app settings with every default filled in, from whatever
 * the document holds: nothing at all on a store from before this screen, or a
 * lean read that skips the schema's defaults.
 */
export function resolveMobileAppSettings(raw: unknown): MobileAppSettings {
  const root = isPlainObject(raw) ? raw : {};
  const shop = isPlainObject(root.shop) ? root.shop : {};
  const biz = isPlainObject(root.biz) ? root.biz : {};
  const ios = isPlainObject(shop.ios) ? shop.ios : {};
  const android = isPlainObject(shop.android) ? shop.android : {};
  const bizIos = isPlainObject(biz.ios) ? biz.ios : {};
  const bizAndroid = isPlainObject(biz.android) ? biz.android : {};

  return {
    shop: {
      enabled: shop.enabled === true,
      scheme: text(shop.scheme) ?? "",
      ios: {
        bundleId: text(ios.bundleId),
        teamId: text(ios.teamId),
        appStoreUrl: text(ios.appStoreUrl),
        minVersion: text(ios.minVersion),
        latestVersion: text(ios.latestVersion),
      },
      android: {
        packageName: text(android.packageName),
        sha256CertFingerprints: Array.isArray(android.sha256CertFingerprints)
          ? android.sha256CertFingerprints.filter(
              (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
            )
          : [],
        playStoreUrl: text(android.playStoreUrl),
        minVersion: text(android.minVersion),
        latestVersion: text(android.latestVersion),
      },
      allowDigitalPurchases: shop.allowDigitalPurchases === true,
    },
    biz: {
      enabled: biz.enabled === true,
      scheme: text(biz.scheme) ?? "",
      ios: {
        bundleId: text(bizIos.bundleId),
        appStoreUrl: text(bizIos.appStoreUrl),
        minVersion: text(bizIos.minVersion),
        latestVersion: text(bizIos.latestVersion),
      },
      android: {
        packageName: text(bizAndroid.packageName),
        playStoreUrl: text(bizAndroid.playStoreUrl),
        minVersion: text(bizAndroid.minVersion),
        latestVersion: text(bizAndroid.latestVersion),
      },
    },
  };
}

/** The versions and store listing of one platform's app (shopper or business). */
export function mobileAppReleaseFor(
  settings: AppReleaseSettings,
  platform: AppPlatform,
): MobileAppRelease {
  const release =
    platform === "ios"
      ? { ...settings.ios, storeUrl: settings.ios.appStoreUrl }
      : { ...settings.android, storeUrl: settings.android.playStoreUrl };
  return {
    ...(release.minVersion ? { minVersion: release.minVersion } : {}),
    ...(release.latestVersion ? { latestVersion: release.latestVersion } : {}),
    ...(release.storeUrl ? { storeUrl: release.storeUrl } : {}),
  };
}

// ============================================
// App versions
// ============================================

/** How the admin writes a version: 1, 1.4 or 1.4.2. */
const STORED_VERSION = /^\d{1,5}(\.\d{1,5}){0,2}$/;

/**
 * An app version as numbers, or null. The app sends `X-App-Version` from its
 * native version string, which a build tool may suffix ("1.4.2-beta.1",
 * "1.4.2 (87)"), so only the leading numbers count.
 */
export function parseAppVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const match = /^\s*v?(\d{1,5})(?:\.(\d{1,5}))?(?:\.(\d{1,5}))?(?![\d.])/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer. */
function compareAppVersions(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * Whether an app reporting `appVersion` is older than `minVersion`. False when
 * either cannot be read: the gate keeps old apps from writing with rules they
 * do not know, it is not a lock, so an app that sends no version is let by.
 */
export function isBelowMinVersion(appVersion: unknown, minVersion: unknown): boolean {
  const app = parseAppVersion(appVersion);
  const min = parseAppVersion(minVersion);
  if (!app || !min) return false;
  return compareAppVersions(app, min) < 0;
}

// ============================================
// Validation (Settings → Mobile app save)
// ============================================

/**
 * Schemes the app may not claim: the web's own, the platforms' system
 * schemes, and Expo Go's development ones, which Better Auth trusts only in
 * development.
 */
const RESERVED_SCHEMES = new Set([
  "http",
  "https",
  "ws",
  "wss",
  "ftp",
  "file",
  "data",
  "blob",
  "about",
  "javascript",
  "mailto",
  "tel",
  "sms",
  "intent",
  "content",
  "market",
  "itms",
  "itms-apps",
  "itms-services",
  "exp",
  "exps",
]);

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]{1,63}$/;
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;
const PACKAGE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const FINGERPRINT_PATTERN = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const MAX_FINGERPRINTS = 10;
const MAX_TEXT_LENGTH = 512;

/** "MyStore://" → "mystore": what an admin pastes, as the app registers it. */
function normalizeAppScheme(value: string): string {
  return value.trim().toLowerCase().replace(/:(\/\/)?$/, "");
}

/**
 * Whether a scheme may name the store's app: well formed and not the web's or
 * the system's. Checked on save, and again wherever the stored value is
 * trusted (Better Auth's trusted origins), since a document can be written
 * without going through the save.
 */
export function isValidAppScheme(scheme: string): boolean {
  return SCHEME_PATTERN.test(scheme) && !RESERVED_SCHEMES.has(scheme);
}

type FailFn = (path: string, message: string) => void;

/** Normalises and checks an app's scheme in place; returns it ("" when unset). */
function checkScheme(app: Record<string, unknown>, fail: FailFn): string {
  if (typeof app.scheme !== "string") return "";
  const scheme = normalizeAppScheme(app.scheme);
  app.scheme = scheme;
  if (scheme && !SCHEME_PATTERN.test(scheme)) {
    fail(
      "scheme",
      "Use the scheme the app was built with: lowercase letters, digits, and + . - after the first letter.",
    );
  } else if (RESERVED_SCHEMES.has(scheme)) {
    fail("scheme", `"${scheme}" belongs to the system, not to an app.`);
  }
  return scheme;
}

/** Each platform's versions, store listing and app identity, for either app. */
function checkPlatforms(app: Record<string, unknown>, fail: FailFn): void {
  for (const platform of APP_PLATFORMS) {
    const block = app[platform];
    if (!isPlainObject(block)) continue;
    for (const key of Object.keys(block)) {
      if (typeof block[key] !== "string") continue;
      block[key] = (block[key] as string).trim();
      if ((block[key] as string).length > MAX_TEXT_LENGTH) {
        fail(`${platform}.${key}`, `At most ${MAX_TEXT_LENGTH} characters.`);
      }
    }

    for (const key of ["minVersion", "latestVersion"] as const) {
      const value = block[key];
      if (typeof value === "string" && value && !STORED_VERSION.test(value)) {
        fail(`${platform}.${key}`, "Write a version as 1, 1.4 or 1.4.2.");
      }
    }
    const min = parseAppVersion(block.minVersion);
    const latest = parseAppVersion(block.latestVersion);
    if (
      min &&
      latest &&
      STORED_VERSION.test(String(block.minVersion)) &&
      STORED_VERSION.test(String(block.latestVersion)) &&
      compareAppVersions(min, latest) > 0
    ) {
      fail(`${platform}.minVersion`, "The minimum version cannot be above the latest version.");
    }

    const storeUrlKey = platform === "ios" ? "appStoreUrl" : "playStoreUrl";
    const storeUrl = block[storeUrlKey];
    if (typeof storeUrl === "string" && storeUrl && !isHttpsUrl(storeUrl)) {
      fail(`${platform}.${storeUrlKey}`, "The store listing must be an https:// link.");
    }
  }

  // The team ID and the signing fingerprints are the shopper app's only (its
  // links open in it); the registry never hands the business app's save any.
  const ios = app.ios;
  if (isPlainObject(ios)) {
    if (typeof ios.bundleId === "string" && ios.bundleId && !BUNDLE_ID_PATTERN.test(ios.bundleId)) {
      fail("ios.bundleId", "A bundle ID looks like com.example.store.");
    }
    if (typeof ios.teamId === "string" && ios.teamId) {
      const teamId = ios.teamId.toUpperCase();
      ios.teamId = teamId;
      if (!TEAM_ID_PATTERN.test(teamId)) {
        fail("ios.teamId", "An Apple team ID is 10 letters and digits.");
      }
    }
  }

  const android = app.android;
  if (isPlainObject(android)) {
    if (
      typeof android.packageName === "string" &&
      android.packageName &&
      !PACKAGE_NAME_PATTERN.test(android.packageName)
    ) {
      fail("android.packageName", "A package name looks like com.example.store.");
    }
    if (Array.isArray(android.sha256CertFingerprints)) {
      const fingerprints = android.sha256CertFingerprints
        .map((entry) => (typeof entry === "string" ? entry.trim().toUpperCase() : ""))
        .filter(Boolean);
      android.sha256CertFingerprints = [...new Set(fingerprints)];
      if (fingerprints.length > MAX_FINGERPRINTS) {
        fail("android.sha256CertFingerprints", `At most ${MAX_FINGERPRINTS} fingerprints.`);
      } else if (fingerprints.some((entry) => !FINGERPRINT_PATTERN.test(entry))) {
        fail(
          "android.sha256CertFingerprints",
          "A SHA-256 fingerprint is 32 pairs of hex digits separated by colons.",
        );
      }
    }
  }
}

/** The push token, the shopper app's setting that serves both apps. */
function checkExpoToken(shop: Record<string, unknown>, fail: FailFn): void {
  const token = shop.expoAccessToken;
  if (typeof token === "string" && token.trim()) {
    const trimmed = token.trim();
    shop.expoAccessToken = trimmed;
    if (/\s/.test(trimmed) || trimmed.length > MAX_TEXT_LENGTH) {
      fail("expoAccessToken", "Paste the access token exactly as Expo shows it.");
    }
  }
}

/**
 * Checks a Settings → Mobile app save and normalises it in place. The section
 * arrives already shaped by the registry (lib/settings/section-registry.ts),
 * so every value here is a string, a boolean or a string list, or absent.
 * An empty string means "not set" for every text field.
 *
 * `current` is the stored `mobileApp`, for the one rule across the two apps:
 * their schemes must differ, whichever of them this save changes.
 */
export function validateMobileAppSettings(
  data: Record<string, unknown>,
  current?: unknown,
): void {
  const errors: Record<string, string[]> = {};
  const failFor =
    (app: "shop" | "biz"): FailFn =>
    (path, message) => {
      errors[`mobileApp.${app}.${path}`] = [message];
    };

  const shop = isPlainObject(data.shop) ? data.shop : null;
  const biz = isPlainObject(data.biz) ? data.biz : null;
  if (shop) {
    checkScheme(shop, failFor("shop"));
    checkPlatforms(shop, failFor("shop"));
    checkExpoToken(shop, failFor("shop"));
  }
  if (biz) {
    checkScheme(biz, failFor("biz"));
    checkPlatforms(biz, failFor("biz"));
  }

  // The scheme tells a sign-in from the shopper app from one from the business
  // app: one scheme for both would hand a shopper's sign-in the business app's
  // audience. Compared after both are normalised, against the stored one when
  // this save leaves it alone.
  const stored = resolveMobileAppSettings(current);
  const shopScheme = typeof shop?.scheme === "string" ? shop.scheme : stored.shop.scheme;
  const bizScheme = typeof biz?.scheme === "string" ? biz.scheme : stored.biz.scheme;
  if (shopScheme && bizScheme && shopScheme === bizScheme && !errors["mobileApp.biz.scheme"]) {
    errors["mobileApp.biz.scheme"] = [
      "The business app needs its own scheme, different from the shopper app's.",
    ];
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}
