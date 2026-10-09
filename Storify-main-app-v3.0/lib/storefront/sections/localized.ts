import type { LocalizedText } from "./types";

/**
 * Resolve a translatable field to the string for `locale`.
 *
 * Plain strings pass through untouched — including empty ones, which are
 * meaningful ("" on a title means "no heading", the semantics the legacy
 * config relied on). For per-locale records the chain is exact locale →
 * admin default language → first non-empty value, so a missing translation
 * shows the default-language copy instead of blanking the section.
 */
export function lt(
  value: LocalizedText | undefined,
  locale: string,
  defaultLanguage: string,
): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const exact = value[locale];
  if (typeof exact === "string") return exact;
  const fallback = value[defaultLanguage];
  if (typeof fallback === "string") return fallback;
  for (const candidate of Object.values(value)) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return "";
}
