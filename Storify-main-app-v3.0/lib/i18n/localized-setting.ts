import { isValidLocale, type Locale } from "@/config/i18n.config";
import { isRecord } from "@/lib/utils";

export type LocalizedSetting = Partial<Record<Locale, string>>;

/** Keep merchant overrides bounded and limited to supported language codes. */
export function normalizeLocalizedSetting(value: unknown): LocalizedSetting {
  if (!isRecord(value)) return {};
  const result: LocalizedSetting = {};
  for (const [locale, text] of Object.entries(value)) {
    if (!isValidLocale(locale) || typeof text !== "string") continue;
    const trimmed = text.trim().slice(0, 120);
    if (trimmed) result[locale] = trimmed;
  }
  return result;
}

/**
 * A legacy unlocalized override belongs to the store's default language.
 * Never let it override another language's dictionary. Shipped English
 * defaults are dictionary text, even when an older save contains them.
 */
export function resolveLocalizedSetting({
  value,
  translations,
  locale,
  defaultLocale,
  fallback,
  legacyDefaults = [],
}: {
  value?: string;
  translations?: LocalizedSetting;
  locale: string;
  defaultLocale: string;
  fallback: string;
  legacyDefaults?: readonly string[];
}): string {
  const translated = isValidLocale(locale) ? translations?.[locale]?.trim() : undefined;
  if (translated) return translated;
  const legacy = value?.trim();
  const canonical = (text: string) => text.toLowerCase().replace(/\u2026/g, "...");
  const shipped = legacy && legacyDefaults.some(text => canonical(text) === canonical(legacy));
  return locale === defaultLocale && legacy && !shipped ? legacy : fallback;
}

export const LEGACY_SEARCH_PLACEHOLDERS = ["Search products...", "Search products", "Search for products..."] as const;
