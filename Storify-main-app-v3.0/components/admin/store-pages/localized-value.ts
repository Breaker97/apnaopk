import type { LocalizedText } from "@/lib/storefront/sections/types";

/**
 * Editing helpers for LocalizedText fields.
 *
 * Values stay plain strings for as long as only the default language has
 * content — the shape every pre-translation document already has — and
 * upgrade to a per-locale record the first time another locale is edited.
 */

export function localizedDisplayValue(
  value: unknown,
  locale: string,
  defaultLanguage: string,
): string {
  if (typeof value === "string") {
    return locale === defaultLanguage ? value : "";
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const entry = (value as Record<string, unknown>)[locale];
    return typeof entry === "string" ? entry : "";
  }
  return "";
}

export function setLocalizedValue(
  current: unknown,
  locale: string,
  defaultLanguage: string,
  next: string,
): LocalizedText {
  if (typeof current === "object" && current !== null && !Array.isArray(current)) {
    return { ...(current as Record<string, string>), [locale]: next };
  }
  const base = typeof current === "string" ? current : "";
  if (locale === defaultLanguage) return next;
  return { [defaultLanguage]: base, [locale]: next };
}
