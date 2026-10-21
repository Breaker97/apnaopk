import { resolveBrand } from "@/lib/branding/brand";
import { isRecord } from "@/lib/utils";
import { resolveThemeSchemes, type BrandColors } from "./compile";
import { getActiveThemeManifest, getThemeDefaults, THEME_MANIFESTS } from "./registry";
import {
  adoptThemeKeyColors,
  normalizeThemeTokens,
  storedThemeColors,
  type ThemeTokens,
} from "./tokens";

/**
 * Key colours belong to each theme (colour schema 4, see adoptThemeKeyColors).
 * Two server-side jobs keep the rest of the app in step with that:
 *
 * - Adoption: a store upgrading from one store-wide brand hands every theme
 *   still following it its own copy, in ONE write — the first save in the
 *   theme editor, a theme switch, or `db:migrate theme-key-colors`.
 * - The mirror: `appearance.primaryColor` / `secondaryColor` / `accentColor`
 *   hold the LIVE theme's key colours, so the dashboards, emails, the mobile
 *   apps and the Apparent sidebar follow whichever theme is live without each
 *   reading theme tokens. Only these writers set them.
 */

type ThemeSettingsSource = { themeSettings?: Record<string, unknown> } | null | undefined;

/** The $set entries that give every theme still following the brand its own colours. */
export function adoptionUpdates(
  onlineStore: unknown,
  brand: BrandColors,
  { except }: { except?: string } = {},
): Record<string, unknown> {
  const stored = (onlineStore as ThemeSettingsSource)?.themeSettings ?? {};
  const updates: Record<string, unknown> = {};
  for (const manifest of THEME_MANIFESTS) {
    if (manifest.id === except) continue;
    const defaults = getThemeDefaults(manifest);
    const tokens = normalizeThemeTokens(defaults, stored[manifest.id]);
    if (tokens.colors.schemaVersion === 4) continue;
    // Only the colours change; whatever else the theme stored stays as stored.
    updates[`onlineStore.themeSettings.${manifest.id}.colors`] = storedThemeColors(
      adoptThemeKeyColors(tokens, brand),
      defaults,
    ).colors;
  }
  return updates;
}

/** A theme's tokens as the editor and the mirror see them: adopted if they were not yet. */
export function ownThemeTokens(
  manifestId: string,
  onlineStore: unknown,
  brand: BrandColors,
): ThemeTokens {
  const manifest = THEME_MANIFESTS.find((entry) => entry.id === manifestId) ?? THEME_MANIFESTS[0];
  const stored = (onlineStore as ThemeSettingsSource)?.themeSettings ?? {};
  return adoptThemeKeyColors(
    normalizeThemeTokens(getThemeDefaults(manifest), stored[manifest.id]),
    brand,
  );
}

/** The live theme's key colours, as the `appearance.*` mirror stores them. */
export function keyColorMirror(tokens: ThemeTokens, brand: BrandColors) {
  const light = resolveThemeSchemes(tokens, brand).light;
  return {
    "appearance.primaryColor": light.primary,
    "appearance.secondaryColor": light.secondary,
    "appearance.accentColor": light.accent,
  };
}

/**
 * The live theme's key colours, read from the theme itself — what the
 * dashboards, emails and mobile apps paint with.
 *
 * The `appearance.*` mirror holds the same colours, written on every save and
 * activation, but a mirror can fall behind (a theme made live by another tool,
 * a restore, a seed that rewrites `appearance`): a reader that trusted it
 * would show the dashboards in last week's colours while the shop wore this
 * week's. Deriving them here means the two cannot disagree. Settings without
 * a live theme (a store that never chose one) keep their stored brand.
 */
export function liveKeyColors(settings: unknown): { primary: string; secondary: string; accent: string } {
  const source = isRecord(settings) ? settings : {};
  const brand = resolveBrand({ appearance: source.appearance }).colors;
  const activeTheme = isRecord(source.onlineStore) ? source.onlineStore.activeTheme : undefined;
  if (typeof activeTheme !== "string" || !activeTheme) {
    return { primary: brand.primary, secondary: brand.secondary, accent: brand.accent };
  }
  const manifest = getActiveThemeManifest(activeTheme);
  const light = resolveThemeSchemes(ownThemeTokens(manifest.id, source.onlineStore, brand), brand).light;
  return { primary: light.primary, secondary: light.secondary, accent: light.accent };
}

/** Each theme's resolved key colours, for the Themes gallery's palette strips. */
export function themePalettes(onlineStore: unknown, brand: BrandColors) {
  return Object.fromEntries(
    THEME_MANIFESTS.map((manifest) => {
      const light = resolveThemeSchemes(ownThemeTokens(manifest.id, onlineStore, brand), brand).light;
      return [manifest.id, [light.primary, light.secondary, light.accent, light.skeleton]];
    }),
  ) as Record<string, [string, string, string, string]>;
}
