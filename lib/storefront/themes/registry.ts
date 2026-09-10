import {
  ELECTRONICS_GROUP_PRESETS,
  ELECTRONICS_HOME_PRESET,
  ELECTRONICS_PRODUCT_PRESET,
  ESSENTIAL_GROUP_PRESETS,
  ESSENTIAL_HOME_PRESET,
  ESSENTIAL_PRODUCT_PRESET,
  LUXE_HOME_PRESET,
  LUXE_PRODUCT_PRESET,
} from "./presets";
import {
  legacySettingsView,
  normalizeThemeTokens,
  resolveThemeDefaults,
  type ThemeTokenOverrides,
  type ThemeTokens,
} from "./tokens";
import type { ThemeManifest } from "./types";

/**
 * Per-theme token defaults. Only what differs from the engine base
 * (`BASE_THEME_TOKENS`) is stated; a merchant's edits are stored as a
 * partial over the resolved result. This is the whole of a theme's "CSS".
 */
const ELECTRONICS_TOKENS: ThemeTokenOverrides = {
  // Harder edges, tighter technical headings, an edge-to-edge hero.
  shape: { cardRadius: 6, badgeRadius: 4 },
  type: { headingTracking: -0.03 },
  layout: { sliderWidth: "full", sliderHeight: "threeQuarters" },
};

const ESSENTIAL_TOKENS: ThemeTokenOverrides = {
  // The engine base IS Classic: contained hero, generous radius.
};

const LUXE_TOKENS: ThemeTokenOverrides = {
  // Editorial serif display, softer radii, airier headings.
  type: {
    headingFont: "cormorant-garamond",
    headingWeight: "600",
    headingTracking: 0.01,
  },
  shape: { cardRadius: 14 },
};

/**
 * The theme catalog. Themes differentiate through design tokens (globals.css
 * blocks keyed by data-store-theme), per-theme presets for fresh installs,
 * and targeted section overrides (themes/overrides.tsx) — never through
 * content, which survives every switch untouched.
 */
export const essentialTheme: ThemeManifest = {
  id: "essential",
  version: "2.0.0",
  status: "stable",
  name: "Classic Marketplace",
  description:
    "Balanced storefront for general retail catalogs and multi-category merchandising.",
  accent: "from-slate-600 to-slate-800",
  preview: {
    card: "/templates/essential/preview-card.jpg",
    mobile: "/templates/essential/preview-mobile.jpg",
  },
  tokens: ESSENTIAL_TOKENS,
  presets: {
    templates: {
      home: ESSENTIAL_HOME_PRESET,
      product: ESSENTIAL_PRODUCT_PRESET,
    },
    groups: ESSENTIAL_GROUP_PRESETS,
  },
};

const electronicsTheme: ThemeManifest = {
  id: "electronics",
  version: "2.0.0",
  status: "stable",
  name: "Electronics",
  description:
    "High-spec product storytelling with comparison-friendly cards and performance callouts.",
  accent: "from-blue-600 to-cyan-600",
  preview: {
    card: "/templates/electronics/preview-card.jpg",
    mobile: "/templates/electronics/preview-mobile.jpg",
  },
  extends: "essential",
  tokens: ELECTRONICS_TOKENS,
  // The listing card (Figma 540:1890) is a configurator template, seeded on
  // activation so the merchant can tune it rather than fight a fixed layout.
  productCard: "electronics",
  // Essential and Fashion prefer the first (legacy) designs, so they omit
  // this — absent means the registry defaults apply.
  preferredVariants: {
    "category-list": "circles",
    // No entry for "featured-collection": its designs collapsed into the
    // single "Top Collections" row layout when it went variant-free.
    "countdown-offer": "deals-panel",
    "product-group": "centered",
    "brand-list": "strip",
    // No entry for "promotion-grid": its layout is a `grid` setting now, not
    // a variant, and the section picker's setup wizard asks for it directly.
    // No entry for "heading": its two designs became explicit `accent`,
    // `align` and `size` settings, which the preset above fills in.
  },
  presets: {
    templates: {
      home: ELECTRONICS_HOME_PRESET,
      product: ELECTRONICS_PRODUCT_PRESET,
    },
    groups: ELECTRONICS_GROUP_PRESETS,
  },
};

/**
 * The Fashion bundle, parked. v2.0 ships TWO templates — Electronics
 * (default) and Classic — because this theme never got a design of its own:
 * two CSS declarations, one variant, one override, and Classic's chrome.
 * Shown in the gallery as coming-soon rather than deleted, so the work it
 * already has survives to v2.1, when it gets the design that makes it a
 * third template. It already sells under its v2.1 name — "Fashion" — but
 * keeps the internal id "luxe" (CSS blocks, preset instance keys, stored
 * themeSettings). No `preview`: there is nothing real to screenshot yet, so
 * the card renders its accent gradient instead of a capture of Classic.
 * `coming-soon` is load-bearing here — the activation route, the install
 * picker, the demo surface and the preset parity test all key off it, so
 * this one word is the whole scope gate.
 */
const luxeTheme: ThemeManifest = {
  id: "luxe",
  version: "2.0.0",
  status: "coming-soon",
  name: "Fashion",
  description:
    "Editorial-style visual treatment for premium fashion, beauty, and lifestyle brands.",
  accent: "from-amber-600 to-rose-600",
  extends: "essential",
  tokens: LUXE_TOKENS,
  presets: {
    // Plain product page for the same reason as the plain bars below:
    // switching to Luxe must undo another theme's product layout too.
    templates: { home: LUXE_HOME_PRESET, product: LUXE_PRODUCT_PRESET },
    // Plain bars: switching to Luxe must undo another theme's chrome too.
    groups: ESSENTIAL_GROUP_PRESETS,
  },
};

/** Gallery order — the default template leads. */
export const THEME_MANIFESTS: ThemeManifest[] = [
  electronicsTheme,
  essentialTheme,
  luxeTheme,
];

/**
 * Unknown, unset, or coming-soon ids resolve to ELECTRONICS — the product's
 * default template — so a fresh install stands up in it without a stored
 * choice. "essential" (Classic) stays a first-class, explicitly selectable
 * id; only the fallback moved.
 */
export function getActiveThemeManifest(activeTheme: unknown): ThemeManifest {
  const manifest = THEME_MANIFESTS.find(
    (candidate) => candidate.id === activeTheme,
  );
  return manifest && manifest.status === "stable" ? manifest : electronicsTheme;
}

interface ResolvedTheme {
  id: string;
  /** The manifest's complete defaults — what "Reset" returns to. */
  defaults: ThemeTokens;
  /** Defaults with the merchant's stored overrides applied, normalized. */
  tokens: ThemeTokens;
  /**
   * The flat, legacy-shaped view sections still read through
   * `ctx.themeSettings` (slider inheritance, container). Derived from
   * `tokens`, never stored.
   */
  settings: Record<string, unknown>;
}

/** A manifest's complete token set (base ← manifest overrides). */
export function getThemeDefaults(manifest: ThemeManifest): ThemeTokens {
  return resolveThemeDefaults(manifest.tokens);
}

/**
 * Resolve `settings.onlineStore` into the active theme and its tokens.
 * Values are stored PER THEME so switching away and back loses nothing;
 * documents written by the v1 settings tab migrate on read
 * (`migrateLegacyThemeSettings`).
 */
export function resolveActiveTheme(onlineStore: unknown): ResolvedTheme {
  const source =
    typeof onlineStore === "object" && onlineStore !== null
      ? (onlineStore as {
          activeTheme?: unknown;
          themeSettings?: Record<string, unknown>;
        })
      : {};
  const manifest = getActiveThemeManifest(source.activeTheme);
  const rawValues =
    source.themeSettings &&
    typeof source.themeSettings === "object" &&
    !Array.isArray(source.themeSettings)
      ? source.themeSettings[manifest.id]
      : undefined;
  const defaults = getThemeDefaults(manifest);
  const tokens = normalizeThemeTokens(defaults, rawValues);
  return {
    id: manifest.id,
    defaults,
    tokens,
    settings: legacySettingsView(tokens),
  };
}
