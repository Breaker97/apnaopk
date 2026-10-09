"use client";

/**
 * The client-side boundary between the two ways a path can be written.
 *
 * The app spells page paths `/${locale}/products` — hundreds of call sites do,
 * and they compare against that spelling too. The address bar spells them the
 * way `lib/i18n/locale-prefix.ts` decides: unprefixed for the store's default
 * language, prefixed for every other one. These hooks translate between the
 * two, so no call site has to know which mode the store is in:
 *
 * - `useRouter` / `useLocaleHref` translate OUTWARD (app spelling → address bar)
 * - `usePathname` translates INWARD (address bar → app spelling), which is what
 *   keeps every `pathname === \`/${locale}/account\`` check working when the
 *   locale is no longer in the URL.
 *
 * Both are drop-in replacements for the `next/navigation` hooks of the same
 * name — that is the whole point, and why the import swap is all a component
 * needs.
 *
 * Every page request that leaves through here also records its language in
 * the locale cookie first — see `rememberLocale`.
 */

import { useCallback, useMemo } from "react";
import {
  useParams,
  usePathname as useNextPathname,
  useRouter as useNextRouter,
} from "next/navigation";
import { defaultLocale, isValidLocale, type Locale } from "@/config/i18n.config";
import {
  browserPathLocale,
  LOCALE_COOKIE_NAME,
  toBrowserPath,
  toInternalPath,
} from "@/lib/i18n/locale-prefix";
import { useAppSettings } from "@/providers/app-settings-provider";

type AppRouter = ReturnType<typeof useNextRouter>;

/**
 * Records `locale` as the language this visitor is browsing in, unless the
 * locale cookie already says so.
 *
 * An unprefixed URL belongs to the store default, but the proxy serves it in
 * that language only while this cookie agrees: a cookie naming another enabled
 * language sends the visitor on to that language's prefix. So a request for
 * the store default has to carry its language, or a switch to it is bounced
 * straight back to the language being left — the language switcher appeared
 * to do nothing, and the store default became unreachable.
 *
 * next-intl's own Link and router write this cookie on a language switch;
 * ours replace them, so they write it themselves. The proxy is no substitute:
 * next-intl updates the cookie only on a full page load, and not even then
 * when the service worker (public/sw.js) forwards the load, because a
 * forwarded navigation arrives as `Sec-Fetch-Dest: empty`.
 *
 * Same attributes as the proxy's (path `/`, `SameSite=Lax`, session), so it
 * stays one cookie whichever side wrote it last.
 */
export function rememberLocale(locale: string | null) {
  if (!locale || typeof document === "undefined") return;

  const entry = `${LOCALE_COOKIE_NAME}=${locale}`;
  if (document.cookie.split("; ").includes(entry)) return;
  document.cookie = `${entry}; path=/; samesite=lax`;
}

/** The language whose URLs carry no prefix. */
export function useStoreDefaultLocale(): Locale {
  const { defaultLanguage } = useAppSettings();
  const candidate = String(defaultLanguage || "").toLowerCase();
  return isValidLocale(candidate) ? candidate : defaultLocale;
}

/**
 * The locale the current page is being served in.
 *
 * Read from the route params rather than next-intl's `useLocale()`: the proxy
 * rewrites an unprefixed URL onto `app/[locale]`, so the param is filled in
 * either way, and unlike `useLocale()` this works in the handful of places
 * that render outside `NextIntlClientProvider` (`app/global-error.tsx`).
 */
function useCurrentLocale(): Locale {
  const params = useParams();
  const storeDefault = useStoreDefaultLocale();

  const raw = params?.locale;
  const candidate = String(
    (Array.isArray(raw) ? raw[0] : raw) ?? "",
  ).toLowerCase();

  return isValidLocale(candidate) ? candidate : storeDefault;
}

/**
 * Translates a href written in the app's spelling into the one the browser
 * should see. A href that names its own locale (`/bn/products`, what the
 * language switcher builds) keeps it; a locale-less one is resolved against
 * the current page's locale.
 */
export function useLocaleHref(): (href: string) => string {
  const currentLocale = useCurrentLocale();
  const storeDefault = useStoreDefaultLocale();

  return useCallback(
    (href: string) => toBrowserPath(href, { currentLocale, storeDefault }),
    [currentLocale, storeDefault],
  );
}

/**
 * `rememberLocale` for a page about to be requested, given the href the
 * browser will use (`useLocaleHref`'s output, or the address bar itself).
 */
export function useRememberLocale(): (browserHref: string) => void {
  const storeDefault = useStoreDefaultLocale();

  return useCallback(
    (browserHref: string) =>
      rememberLocale(browserPathLocale(browserHref, storeDefault)),
    [storeDefault],
  );
}

/**
 * `useRouter` with every destination run through `useLocaleHref`, so a
 * `router.push("/${locale}/orders")` written years ago lands on the URL this
 * store actually serves instead of bouncing through a redirect.
 *
 * `push`, `replace` and `refresh` record the language of the page they are
 * about to request (`rememberLocale`); `prefetch` does not, since fetching a
 * page ahead of time is not a visit to it.
 */
export function useRouter(): AppRouter {
  const router = useNextRouter();
  const localeHref = useLocaleHref();
  const rememberLocaleOf = useRememberLocale();

  return useMemo<AppRouter>(() => {
    const visit = (href: string) => {
      const target = localeHref(href);
      rememberLocaleOf(target);
      return target;
    };

    return {
      ...router,
      // Rest args rather than a named `options`, so a one-argument call stays
      // a one-argument call: passing an explicit `undefined` through would
      // change what the router (and anything spying on it) sees.
      push: (href, ...rest) => router.push(visit(href), ...rest),
      replace: (href, ...rest) => router.replace(visit(href), ...rest),
      prefetch: (href, ...rest) => router.prefetch(localeHref(href), ...rest),
      // A refresh requests the page in the address bar again, so it carries
      // that page's language. It can differ from the cookie's: Back into the
      // store default after a switch away from it restores the page from the
      // router's cache, and StorefrontRefresh refreshes it once it has aged.
      refresh: () => {
        rememberLocaleOf(window.location.pathname);
        router.refresh();
      },
    };
  }, [router, localeHref, rememberLocaleOf]);
}

/**
 * `usePathname` in the app's own spelling — always locale-prefixed, whatever
 * the address bar shows. Everything that derives a URL from it (active-nav
 * checks, the language switcher, "back to where I was") therefore keeps
 * working unchanged, and pushing the result back through `useRouter` returns
 * it to the browser's spelling.
 */
export function usePathname(): string {
  const pathname = useNextPathname();
  const locale = useCurrentLocale();

  return useMemo(
    () => toInternalPath(pathname || "/", locale),
    [pathname, locale],
  );
}
