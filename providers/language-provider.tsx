"use client";

import { useLocale } from "next-intl";
import { useAppSettings } from "@/providers/app-settings-provider";
import { defaultLocale, localeConfig, locales } from "@/config/i18n.config";

/**
 * Language metadata for UI display (header badge, language dropdowns).
 *
 * Derived from config/i18n.config.ts — the single source of truth for
 * available locales — so the picker can never offer a locale the router
 * doesn't serve. The ACTIVE language is the URL locale (next-intl); changing
 * language means navigating to the same path under another locale prefix.
 * There is no client-side language state or persistence: next-intl's
 * middleware remembers the visitor's choice in the NEXT_LOCALE cookie.
 */
interface Language {
  code: string;
  name: string;
  nativeName: string;
  direction: "ltr" | "rtl";
  flag: string;
  /** ISO 3166-1 alpha-2 country code, used to render a real flag image. */
  countryCode: string;
}

const LANGUAGES: Language[] = locales.map((code) => {
  const config = localeConfig[code];
  return {
    code,
    name: config.name,
    nativeName: config.nativeName,
    direction: config.direction,
    flag: config.flag,
    countryCode: config.countryCode,
  };
});

const LANGUAGE_BY_CODE = new Map(LANGUAGES.map((lang) => [lang.code, lang]));

const FALLBACK_LANGUAGE =
  LANGUAGE_BY_CODE.get(defaultLocale) ?? LANGUAGES[0];

function resolveLanguage(code: string | undefined): Language {
  return (
    LANGUAGE_BY_CODE.get(String(code || "").toLowerCase()) ?? FALLBACK_LANGUAGE
  );
}

/**
 * Hook to access the active language and the selectable language list.
 *
 * - `language` mirrors the URL locale, so it is always correct — including on
 *   direct visits to a localized URL (the old zustand store showed a stale
 *   badge there).
 * - `languages` is filtered by the admin's supported-languages setting
 *   (settings.general.supportedLanguages); the active language is always
 *   included so the UI never shows an empty/foreign selection.
 */
export function useLanguage() {
  const locale = useLocale();
  const { supportedLanguages } = useAppSettings();

  const language = resolveLanguage(locale);

  const supported = new Set(
    (supportedLanguages ?? []).map((code) => String(code).toLowerCase()),
  );
  const languages =
    supported.size > 0
      ? LANGUAGES.filter(
          (lang) => supported.has(lang.code) || lang.code === language.code,
        )
      : LANGUAGES;

  return {
    language,
    languages,
    isRTL: language.direction === "rtl",
  };
}

/**
 * Swaps the locale prefix of a localized pathname. With next-intl's
 * `localePrefix: "always"` every page path starts with its locale, so this is
 * the one sanctioned way to build the target URL when the visitor picks
 * another language.
 */
export function swapLocaleInPathname(
  pathname: string,
  currentLocale: string,
  nextLocale: string,
): string {
  if (pathname === `/${currentLocale}`) return `/${nextLocale}`;
  if (pathname.startsWith(`/${currentLocale}/`)) {
    return `/${nextLocale}${pathname.slice(currentLocale.length + 1)}`;
  }
  return `/${nextLocale}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}
