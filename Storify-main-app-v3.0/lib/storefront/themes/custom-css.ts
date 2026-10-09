/**
 * Merchant-written CSS, one sheet per theme.
 *
 * Stored under `settings.onlineStore.customCss[themeId]` beside the theme's
 * tokens, for the same reason tokens are per theme: a rule written against
 * one template's markup is noise — or damage — under another, and a merchant
 * who switches back should find their sheet where they left it.
 *
 * Pure module: the Themes page's CSS tab, the API route and the storefront
 * layout all read through it, so a sheet is neutralized in exactly one place.
 */

export const CUSTOM_CSS_MAX_LENGTH = 50_000;

/**
 * The sheet is printed inside a `<style>` element on every storefront page.
 * A closing tag inside it would end that element early and hand the rest of
 * the sheet to the HTML parser, so the sequence is escaped the way CSS
 * itself allows (`<\/style` is still the same text to a stylesheet). Length
 * is clamped rather than refused: the editor shows the limit, the store
 * should never 500 over an oversized document.
 */
export function normalizeCustomCss(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\0/g, "")
    .replace(/<\/(style|script)/gi, "<\\/$1")
    .slice(0, CUSTOM_CSS_MAX_LENGTH)
    .trim();
}

/** The active theme's sheet from the stored `onlineStore` object, or "". */
export function readCustomCss(onlineStore: unknown, themeId: string): string {
  if (typeof onlineStore !== "object" || onlineStore === null) return "";
  const sheets = (onlineStore as { customCss?: unknown }).customCss;
  if (typeof sheets !== "object" || sheets === null || Array.isArray(sheets)) {
    return "";
  }
  return normalizeCustomCss((sheets as Record<string, unknown>)[themeId]);
}
