export const DEFAULT_STORE_NAME = "Storify";
export const DEFAULT_CURRENCY = "USD";
export const DEFAULT_LANGUAGE = "en";
export const DEFAULT_TIMEZONE = "UTC";

export const DEFAULT_PRIMARY_COLOR = "#2065D1";
export const DEFAULT_SECONDARY_COLOR = "#8b5cf6";
export const DEFAULT_ACCENT_COLOR = "#f59e0b";
export const DEFAULT_PRESET_COLOR = "default";

/**
 * The only two themes the app renders. Following the OS
 * (`prefers-color-scheme`) is deliberately *not* an option: light is always the
 * default and dark is only ever entered by an explicit choice — the admin
 * setting (`appearance.theme`) or a visitor toggling it in the header.
 */
export type ThemeMode = "light" | "dark";
export const THEME_MODES: readonly ThemeMode[] = ["light", "dark"];
export const DEFAULT_THEME_MODE: ThemeMode = "light";

/**
 * Coerce any stored/incoming theme value to a renderable mode.
 *
 * `"system"` is a legacy value: it is still present in databases and in
 * visitors' `localStorage` from before OS-preference mode was removed, and it
 * folds down to light like every other unrecognized value.
 */
export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "dark" ? "dark" : DEFAULT_THEME_MODE;
}

/** True only for values this app still renders — legacy `"system"` is not one. */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark";
}

/**
 * Paths the app used to ship as bundled placeholder icons. They are no longer
 * part of the build, and a store that still has one of them stored in
 * `general.faviconUrl` must be treated as having no favicon at all — otherwise
 * every page, the manifest and every link preview would point at a 404.
 */
const LEGACY_PLACEHOLDER_FAVICONS = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/pwa/icon.svg",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
]);

/**
 * Brand image URLs are admin-configured and have no fallback by design: the app
 * never substitutes its own branding into a buyer's storefront. When nothing is
 * configured this returns `undefined` and every consumer (metadata icons, the
 * PWA manifest, `/favicon.ico`, push notifications) simply emits nothing.
 */
function resolveBrandImageUrl(value?: string | null): string | undefined {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url || LEGACY_PLACEHOLDER_FAVICONS.has(url)) {
    return undefined;
  }
  return url;
}

/**
 * Brand text the demo seeder used to stamp into a fresh database. Each one is a
 * *copy* of this app's own name sitting in a field that outranks
 * `general.storeName`, so renaming the store in Settings → General appeared to
 * do nothing: the browser tab, every link preview and every outbound email kept
 * the demo brand. Like the placeholder favicons above, these are shipped sample
 * content rather than an admin's decision, so they are treated as unset and the
 * live store name is used instead.
 */
const LEGACY_SEEDED_BRAND_TEXT = new Set([
  `${DEFAULT_STORE_NAME} - Multi-vendor E-commerce`,
  DEFAULT_STORE_NAME,
]);

/**
 * True for a value that is only there because the seeder put it there. Note
 * that a store genuinely named `DEFAULT_STORE_NAME` loses nothing: clearing the
 * copy just falls the value back to `general.storeName`, which says the same.
 */
export function isLegacySeededBrandText(value?: string | null) {
  return LEGACY_SEEDED_BRAND_TEXT.has(
    typeof value === "string" ? value.trim() : "",
  );
}

/** Tab/link-preview icon — `general.faviconUrl`. Small by design (32px). */
export function resolveFaviconUrl(value?: string | null): string | undefined {
  return resolveBrandImageUrl(value);
}

/**
 * Installed-app icon — `general.appIconUrl`. Deliberately separate from the
 * favicon: a favicon is a 32px tab glyph, while Chrome only offers to install a
 * PWA when the manifest advertises a *square* icon of at least 192px, so the
 * two cannot be the same asset without breaking one of them.
 */
export function resolveAppIconUrl(value?: string | null): string | undefined {
  return resolveBrandImageUrl(value);
}
