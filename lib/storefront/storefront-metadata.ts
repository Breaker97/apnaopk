import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { appConfig } from "@/config/app.config";
import {
  DEFAULT_CURRENCY,
  resolveAppIconUrl,
  resolveFaviconUrl,
} from "@/config/branding.config";
import {
  defaultLocale,
  isValidLocale,
  locales,
  type Locale,
} from "@/config/i18n.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { appIconPath, appIconVersion } from "@/lib/pwa/pwa-icons";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";

interface StorefrontMetadataSettings {
  storeName: string;
  storeDescription?: string;
  defaultCurrency: string;
  /** Admin-configured only — `undefined` means the store ships no icon. */
  faviconUrl?: string;
  /**
   * Source image for the installed-app (PWA) icon. Falls back to the favicon so
   * stores that predate this setting stay installable; the render route scales
   * whichever image it gets up to the sizes Chrome requires.
   */
  appIconUrl?: string;
  seo: {
    metaTitle?: string;
    metaDescription?: string;
    metaKeywords?: string;
    ogImage?: string;
  };
  social: {
    twitterHandle?: string;
  };
}

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Extract a Twitter handle (without "@") from a profile URL or bare handle.
 * Returns undefined when no handle can be derived.
 */
function extractTwitterHandle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  // Already a bare handle (e.g. "@storify" or "storify").
  const handleMatch = raw.match(/^@?([A-Za-z0-9_]{1,15})$/);
  if (handleMatch) return handleMatch[1];

  // URL form: capture the last non-empty path segment.
  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && /^@?[A-Za-z0-9_]{1,15}$/.test(last)) {
      return last.replace(/^@/, "");
    }
  } catch {
    // not a URL — fall through
  }
  return undefined;
}

export function normalizeMetadataText(value: unknown) {
  const text = normalizeOptionalText(value);
  if (!text) return "";

  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateMetadataText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export const getStorefrontMetadataSettings = unstable_cache(
  async (): Promise<StorefrontMetadataSettings> => {
    try {
      await connectDB();
      const settings = await getSettings();
      const general = settings.general;
      const seo = settings.seo;

      return {
        storeName: normalizeOptionalText(general?.storeName) || appConfig.name,
        storeDescription: normalizeOptionalText(general?.storeDescription),
        defaultCurrency: String(
          general?.defaultCurrency || DEFAULT_CURRENCY,
        ).toUpperCase(),
        faviconUrl: resolveFaviconUrl(general?.faviconUrl),
        appIconUrl:
          resolveAppIconUrl(general?.appIconUrl) ??
          resolveFaviconUrl(general?.faviconUrl),
        seo: {
          metaTitle: normalizeOptionalText(seo?.metaTitle),
          metaDescription: normalizeOptionalText(seo?.metaDescription),
          metaKeywords: normalizeOptionalText(seo?.metaKeywords),
          ogImage: normalizeOptionalText(seo?.ogImage),
        },
        social: {
          twitterHandle: extractTwitterHandle(settings.social?.twitterUrl),
        },
      };
    } catch {
      return {
        storeName: appConfig.name,
        storeDescription: appConfig.description,
        defaultCurrency: DEFAULT_CURRENCY,
        seo: {},
        social: {},
      };
    }
  },
  ["storefront-metadata-settings"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.settings],
  },
);

/**
 * Icon metadata for a page. Returns `undefined` when nothing is configured so
 * Next emits no `<link rel="icon">` at all — a link pointing at a missing file
 * would make browsers and link-preview crawlers fall back to whatever
 * `/favicon.ico` serves, which is exactly the leak this avoids.
 *
 * `apple` is the home-screen icon iOS uses for "Add to Home Screen", and iOS
 * has no manifest-driven equivalent — so it comes from the app-icon render
 * route (at least 180px) rather than the 32px favicon, which iOS would
 * otherwise blow up to fill a home-screen tile.
 */
export function getStorefrontIcons({
  faviconUrl,
  appIconUrl,
}: Pick<
  StorefrontMetadataSettings,
  "faviconUrl" | "appIconUrl"
>): Metadata["icons"] | undefined {
  const appleIcon = appIconUrl
    ? appIconPath({ size: 192, purpose: "any" }, appIconVersion(appIconUrl))
    : undefined;

  if (!faviconUrl && !appleIcon) return undefined;

  return {
    ...(faviconUrl ? { icon: faviconUrl, shortcut: faviconUrl } : {}),
    ...(appleIcon ? { apple: appleIcon } : {}),
  };
}

export function resolveStorefrontBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

/**
 * The locales this store actually serves, plus the one that answers for
 * `x-default`.
 *
 * hreflang must advertise only languages a visitor can really get: emitting
 * every locale the build ships (18 of them) points Google at 16 URLs that
 * redirect or render in the wrong language, and the reciprocity check then
 * fails for all of them. `general.supportedLanguages` is the admin's answer,
 * intersected with the build's `locales` because the settings default carries
 * codes the app has no messages for (e.g. "ko").
 */
export const getEnabledLocales = unstable_cache(
  async (): Promise<{ enabled: Locale[]; storeDefault: Locale }> => {
    try {
      await connectDB();
      const general = (await getSettings()).general;

      const configuredDefault = String(general?.defaultLanguage || "").toLowerCase();
      const storeDefault = isValidLocale(configuredDefault)
        ? configuredDefault
        : defaultLocale;

      const supported = new Set(
        (Array.isArray(general?.supportedLanguages)
          ? general.supportedLanguages
          : []
        )
          .map((code) => String(code).toLowerCase())
          .filter(isValidLocale),
      );
      supported.add(storeDefault);

      // Iterate `locales` rather than the settings array so the order is the
      // build's, not whatever order the admin happened to tick boxes in —
      // otherwise the hreflang block reshuffles between saves.
      return {
        enabled: locales.filter((locale) => supported.has(locale)),
        storeDefault,
      };
    } catch {
      return { enabled: [defaultLocale], storeDefault: defaultLocale };
    }
  },
  ["storefront-enabled-locales"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.settings],
  },
);

/**
 * Self-referencing canonical plus the hreflang set for one page.
 *
 * `page` is the locale-less path (`/products/dumbo-chair`, `""` for the store
 * root). Every storefront page must supply its own — a canonical inherited
 * from an ancestor names the ancestor's URL, which is how every listing, brand
 * and blog post ended up canonicalizing to the home page.
 */
export async function buildStorefrontAlternates({
  locale,
  page,
}: {
  locale: Locale | string;
  page: string;
}): Promise<NonNullable<Metadata["alternates"]>> {
  const baseUrl = resolveStorefrontBaseUrl();
  const normalizedPage = page === "/" ? "" : page;
  const { enabled, storeDefault } = await getEnabledLocales();

  const languages: Record<string, string> = {};
  for (const loc of enabled) {
    languages[loc] = `${baseUrl}/${loc}${normalizedPage}`;
  }
  // Tells Google which version to serve visitors whose language matches none
  // of the above; without it they get whichever locale it guessed.
  languages["x-default"] = `${baseUrl}/${storeDefault}${normalizedPage}`;

  return {
    canonical: `${baseUrl}/${locale}${normalizedPage}`,
    languages,
  };
}

/**
 * Query params that belong in a canonical URL. Pagination identifies a
 * genuinely different set of results, so `?page=2` self-canonicalizes;
 * everything else (sort, facets, utm_*, the location lens) is a view of the
 * same page and collapses onto the clean URL.
 */
const CANONICAL_QUERY_KEYS = ["page"] as const;

/**
 * Turn the proxy-stamped request path into the locale-less `page` argument
 * `buildStorefrontAlternates` wants, or null when there is nothing
 * trustworthy to derive it from — callers then emit no canonical at all,
 * because a wrong canonical de-indexes a page while a missing one only
 * leaves Google to work it out.
 */
export function canonicalPageFromRequestPath(
  requestPath: string | null | undefined,
): string | null {
  if (!requestPath || !requestPath.startsWith("/")) return null;

  const [rawPath = "/", rawQuery = ""] = requestPath.split("?", 2);

  const segments = rawPath.split("/").filter(Boolean);
  if (segments.length && isValidLocale(segments[0])) segments.shift();
  const path = segments.length ? `/${segments.join("/")}` : "";

  const source = new URLSearchParams(rawQuery);
  const canonicalQuery = new URLSearchParams();
  for (const key of CANONICAL_QUERY_KEYS) {
    const value = Number(source.get(key));
    // Page 1 is the clean URL, so only 2+ earns its own canonical.
    if (Number.isInteger(value) && value > 1) {
      canonicalQuery.set(key, String(value));
    }
  }

  const query = canonicalQuery.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Sections that must never enter a search index: back-office apps, the auth
 * flow, and the shopper's own session pages (cart/checkout/account produce a
 * near-infinite set of thin, personalised URLs).
 *
 * This is decided from the path rather than per-page `robots` exports because
 * several of these pages are client components, which cannot export metadata
 * at all — the cart being the obvious one.
 */
const NON_INDEXABLE_PREFIXES = [
  "/admin",
  "/draft",
  "/section-preview",
  "/vendor",
  "/staff",
  "/account",
  "/cart",
  "/checkout",
  "/forbidden",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/email-verified",
  "/role-redirect",
];

/** `page` is a locale-less path as produced by `canonicalPageFromRequestPath`. */
export function isIndexablePage(page: string) {
  const path = page.split("?", 1)[0];
  return !NON_INDEXABLE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
