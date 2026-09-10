import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  normalizeThemeMode,
  resolveAppIconUrl,
  resolveFaviconUrl,
  type ThemeMode,
} from "@/config/branding.config";
import { normalizeColorToHex } from "@/lib/site-config/appearance-colors";

/**
 * The store's brand, as one object.
 *
 * Brand = who the store is (logo set, palette, default appearance). It is
 * theme-agnostic: switching storefront themes never touches it, and every
 * theme consumes it through the token chain (docs/THEME_ENGINE.md, "Design
 * decisions").
 *
 * The values are STILL STORED where their consumers have always read them —
 * assets under `general.*`, colors and the default mode under `appearance.*`.
 * This read model exists so the admin UI (Online Store → Themes → Branding)
 * and the storefront can address the brand as one thing today, and so those
 * storage paths can move into a `brand` section later without touching a
 * single consumer.
 */
interface Brand {
  assets: {
    /** Light-surface logo; empty when the merchant has not uploaded one. */
    logoUrl: string;
    /** Dark-surface logo; falls back to `logoUrl` at the consumer's discretion. */
    darkLogoUrl: string;
    /** Tab icon. Empty means "emit nothing" — never a bundled placeholder. */
    faviconUrl: string;
    /** Installed-app icon. Empty means the favicon is used as a fallback. */
    appIconUrl: string;
  };
  colors: {
    /** Canonical `#rrggbb` (or the shipped default when unset/malformed). */
    primary: string;
    secondary: string;
    accent: string;
  };
  /** Light/dark the store opens in before a visitor picks one themselves. */
  defaultMode: ThemeMode;
}

interface BrandSource {
  general?: {
    logoUrl?: string | null;
    darkModeLogoUrl?: string | null;
    faviconUrl?: string | null;
    appIconUrl?: string | null;
  } | null;
  appearance?: {
    primaryColor?: string | null;
    secondaryColor?: string | null;
    accentColor?: string | null;
    theme?: unknown;
  } | null;
}

function cleanUrl(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Canonical lowercase hex — the shipped defaults included, so a consumer
 * comparing colors never has to care whether one came from the database. */
function brandColor(value: unknown, fallback: string): string {
  return (
    normalizeColorToHex(value) ??
    normalizeColorToHex(fallback) ??
    fallback.toLowerCase()
  );
}

/**
 * Resolve the brand from a settings document (or any object shaped like one —
 * the sanitized admin payload qualifies). Never throws: a legacy document
 * missing whole sub-objects resolves to the shipped defaults.
 */
export function resolveBrand(settings: unknown): Brand {
  const source =
    typeof settings === "object" && settings !== null
      ? (settings as BrandSource)
      : {};
  const general = source.general ?? {};
  const appearance = source.appearance ?? {};

  return {
    assets: {
      logoUrl: cleanUrl(general.logoUrl),
      darkLogoUrl: cleanUrl(general.darkModeLogoUrl),
      // The favicon/app-icon helpers also drop the legacy bundled placeholder
      // paths, which an old database may still hold.
      faviconUrl: resolveFaviconUrl(general.faviconUrl) ?? "",
      appIconUrl: resolveAppIconUrl(general.appIconUrl) ?? "",
    },
    colors: {
      primary: brandColor(appearance.primaryColor, DEFAULT_PRIMARY_COLOR),
      secondary: brandColor(
        appearance.secondaryColor,
        DEFAULT_SECONDARY_COLOR,
      ),
      accent: brandColor(appearance.accentColor, DEFAULT_ACCENT_COLOR),
    },
    defaultMode: normalizeThemeMode(appearance.theme),
  };
}
