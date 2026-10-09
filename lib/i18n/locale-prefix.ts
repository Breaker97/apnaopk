/**
 * Where the locale lives in a URL — the one module that decides it.
 *
 * The store's default language is served WITHOUT a prefix (`/products`), every
 * other enabled language keeps one (`/bn/products`). A store that enables a
 * single language therefore has no locale prefixes at all, which is the point:
 * a one-language shop should not ship `/en/` in every link it prints.
 *
 * Two forms of a path exist and both are legitimate:
 *
 * - the BROWSER form — what the address bar, a `<Link href>`, a canonical tag
 *   and an emailed URL must carry. Built by `toBrowserPath`.
 * - the INTERNAL form — always prefixed, because the app tree lives under
 *   `app/[locale]` and hundreds of call sites compare against `/${locale}/…`.
 *   The proxy rewrites the browser form into it; `toInternalPath` is its
 *   client-side twin for `usePathname`.
 *
 * Everything here is pure and free of server imports: the proxy, server
 * components and the browser all have to agree on the same answer.
 */
import {
  defaultLocale,
  isValidLocale,
  locales,
  type Locale,
} from "@/config/i18n.config";

export interface LocaleRouting {
  /**
   * The locales this store actually serves, in the build's order (not the
   * order the admin happened to tick boxes in, which would reshuffle hreflang
   * between saves).
   */
  enabled: Locale[];
  /** The one locale whose URLs carry no prefix. */
  storeDefault: Locale;
}

/** The raw settings this module reads — `general` from the settings document. */
interface LocaleSettingsInput {
  defaultLanguage?: string | null;
  supportedLanguages?: readonly (string | null | undefined)[] | null;
}

/**
 * Which locales a store serves, and which of them owns the unprefixed URLs.
 *
 * `supportedLanguages` is intersected with the build's `locales` because the
 * settings default carries codes the app has no messages for (e.g. "ko"), and
 * the store default is always added: a language you cannot turn off is the one
 * every unprefixed URL resolves to.
 */
export function resolveLocaleRouting(
  general: LocaleSettingsInput | null | undefined,
): LocaleRouting {
  const configuredDefault = String(general?.defaultLanguage || "").toLowerCase();
  const storeDefault = isValidLocale(configuredDefault)
    ? configuredDefault
    : defaultLocale;

  const supported = new Set<Locale>(
    (Array.isArray(general?.supportedLanguages)
      ? general.supportedLanguages
      : []
    )
      .map((code) => String(code ?? "").toLowerCase())
      .filter(isValidLocale),
  );
  supported.add(storeDefault);

  return {
    enabled: locales.filter((locale) => supported.has(locale)),
    storeDefault,
  };
}

/** The routing a store falls back to when settings cannot be read. */
export const FALLBACK_LOCALE_ROUTING: LocaleRouting = {
  enabled: [defaultLocale],
  storeDefault: defaultLocale,
};

/**
 * The cookie that remembers which language a visitor is browsing in —
 * next-intl's own name for it, handed to next-intl by `proxy.ts` so the two
 * cannot drift apart.
 *
 * It decides what an unprefixed URL serves. A visitor whose cookie names
 * another enabled language is sent on to that language's prefix, which is how
 * a returning visitor keeps their language — and why every request for the
 * store default has to carry it too (see `rememberLocale` in
 * hooks/use-locale-navigation.ts).
 */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/** Does this locale carry a prefix in the address bar? */
function isLocalePrefixed(locale: string, storeDefault: Locale) {
  return locale !== storeDefault;
}

/**
 * Splits a path into its leading locale (if it has one) and the rest, which
 * always starts with `/`. `/bn/products` → `{ locale: "bn", rest: "/products" }`,
 * `/products` → `{ locale: null, rest: "/products" }`, `/bn` → `{ locale: "bn",
 * rest: "/" }`.
 *
 * Every build locale is recognised, not just the enabled ones: a store that
 * turns a language off still has to recognise its old URLs to redirect them.
 */
export function splitLocalePath(pathname: string): {
  locale: Locale | null;
  rest: string;
} {
  const [, first = "", ...others] = pathname.split("/");
  const candidate = first.toLowerCase();

  if (!isValidLocale(candidate)) {
    return { locale: null, rest: pathname || "/" };
  }

  const rest = others.length > 0 ? `/${others.join("/")}` : "/";
  return { locale: candidate, rest };
}

/** Builds the address-bar path for a locale and a locale-less path. */
export function buildLocalePath(
  locale: string,
  rest: string,
  storeDefault: Locale,
) {
  const path = rest.startsWith("/") ? rest : `/${rest}`;

  if (!isLocalePrefixed(locale, storeDefault)) {
    return path;
  }

  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** Splits a href into its path and whatever query/hash trails it. */
function splitSuffix(href: string): [path: string, suffix: string] {
  const index = href.search(/[?#]/);
  return index === -1
    ? [href, ""]
    : [href.slice(0, index), href.slice(index)];
}

/**
 * Paths that never lived under `app/[locale]`, mirroring what `proxy.ts`
 * excludes from its matcher. Prefixing one of these turns a working URL into a
 * 404, so they are left exactly as written.
 */
const UNLOCALIZED_PREFIXES = ["/api/", "/_next/", "/_vercel/"];

/** `/uploads/a.png`, `/manifest.webmanifest` — a file, not a page. */
const FILE_PATTERN = /\.[^/]+$/;

/**
 * A href is ours to rewrite only if it addresses a page on this store. External
 * URLs, `mailto:`/`tel:`, protocol-relative `//host`, bare fragments, relative
 * paths, API routes and static files all pass through untouched.
 */
function isLocalizablePath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return false;
  }
  if (UNLOCALIZED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false;
  }
  return !FILE_PATTERN.test(path);
}

/**
 * Turns a href written anywhere in the app into the one the browser should see.
 *
 * Both spellings are accepted on purpose, so call sites can be cleaned up over
 * time instead of all at once:
 *
 * - `/${locale}/products` — the app's own long-standing spelling. The locale in
 *   the href is honoured, which is what keeps the language switcher working:
 *   it builds `/bn/…` while the page it sits on is English.
 * - `/products` — locale-less. Resolved against `currentLocale`.
 */
export function toBrowserPath(
  href: string,
  options: { currentLocale: string; storeDefault: Locale },
): string {
  const [path, suffix] = splitSuffix(href);
  if (!isLocalizablePath(path)) return href;

  const { locale, rest } = splitLocalePath(path);
  const target = locale ?? options.currentLocale;

  return `${buildLocalePath(target, rest, options.storeDefault)}${suffix}`;
}

/**
 * The language an address-bar href is served in: the locale it is prefixed
 * with, or the store default for an unprefixed one. `null` for anything that
 * is not a page of this store — an external URL, an API route, a file.
 */
export function browserPathLocale(
  href: string,
  storeDefault: Locale,
): Locale | null {
  const [path] = splitSuffix(href);
  if (!isLocalizablePath(path)) return null;

  return splitLocalePath(path).locale ?? storeDefault;
}

/**
 * The always-prefixed form of a browser path, for code that compares against
 * `/${locale}/…`. Paths that already carry a locale are returned as they are.
 */
export function toInternalPath(pathname: string, currentLocale: string): string {
  const [path, suffix] = splitSuffix(pathname);
  if (!isLocalizablePath(path)) return pathname;

  const { locale, rest } = splitLocalePath(path);
  if (locale) return pathname;

  const prefixed = rest === "/" ? `/${currentLocale}` : `/${currentLocale}${rest}`;
  return `${prefixed}${suffix}`;
}
