import {
  getDefaultHeaderLayout,
  resolveHeaderLayout,
} from "@/lib/site-config/header-layout-default";
import {
  DEFAULT_HEADER_LOGO_SIZE,
  headerBrandItem,
  type HeaderLayout,
} from "@/lib/site-config/header-layout";
import { isRecord } from "@/lib/utils";

export interface HeaderColorScheme {
  backgroundColor: string;
  textColor: string;
  searchBackgroundColor: string;
  searchTextColor: string;
}

export type HeaderNavPosition = "left" | "right";

/** Rows the utility/pages link group can live in. */
const HEADER_UTILITY_PLACEMENTS = ["menu", "search", "tags"] as const;
export type HeaderUtilityPlacement =
  (typeof HEADER_UTILITY_PLACEMENTS)[number];

/**
 * Desktop header templates (the Figma "Header Style" cards, top to bottom).
 * Each is a fixed recombination of the existing pieces, applied by
 * StoreHeader:
 * - minimal:     one row — logo, inline nav, compact search, actions
 * - nav-top:     logo + inline nav + actions, categories + search bar below
 * - classic:     logo + search + actions, categories + nav row below
 * - banner-nav:  logo + search + actions, full-width colored nav strip below
 * - centered:    inline nav, centered logo, search + actions
 * - logo-center: search, centered logo, actions, centered nav row below
 */
export const HEADER_STYLE_VARIANTS = [
  "minimal",
  "nav-top",
  "classic",
  "banner-nav",
  "centered",
  "logo-center",
] as const;
export type HeaderStyleVariant = (typeof HEADER_STYLE_VARIANTS)[number];

/**
 * Pre-redesign variants still stored by existing shops, mapped to the
 * closest current template so an old save renders the new system without a
 * data migration.
 */
const LEGACY_HEADER_VARIANTS: Record<string, HeaderStyleVariant> = {
  "search-below": "nav-top",
  compact: "classic",
};

/**
 * The bar's overall paint, one of the Figma "Header Color" chips:
 * - light:       the light/dark schemes follow the shopper's theme
 * - dark:        the dark scheme always — a dark bar on a light store
 * - color:       the store's primary color as the bar background
 * - transparent: translucent glass (bg + backdrop blur)
 */
const HEADER_COLOR_MODES = [
  "light",
  "dark",
  "color",
  "transparent",
] as const;
export type HeaderColorMode = (typeof HEADER_COLOR_MODES)[number];

/**
 * Which logo artwork the bar shows.
 *
 * "light" and "dark" name the ARTWORK, not the shopper's theme: "light" is
 * the primary logo (drawn for light surfaces), "dark" the inverse one
 * uploaded as the dark-mode logo. "auto" follows the shopper's theme.
 *
 * Two paint modes cannot infer this on their own, which is why it is a
 * setting rather than a rule: "color" paints the bar in the store's primary,
 * which may be dark navy or pale yellow, and "transparent" takes whatever
 * the page behind it happens to be.
 */
/**
 * The surface behind the bar while it floats over the home hero — so it
 * names what is BEHIND the ink, like `surfaceTone` does for a row: "dark"
 * (a dark photograph) asks for white type and the inverse logo, "light" for
 * the ordinary dark type. Not inferred from the artwork: the hero is a
 * merchant's own picture, and sampling it client-side would flicker on load
 * and could not run for the first paint.
 */
const HEADER_OVERLAP_TONES = ["dark", "light"] as const;
export type HeaderOverlapTone = (typeof HEADER_OVERLAP_TONES)[number];

/**
 * The bar's drop shadow: drawn under an opaque bar only — a glass bar and a
 * bar floating over the hero cast none. Off, or an offset down, a blur and
 * a strength (the shadow's opacity, 0–100).
 */
export interface HeaderShadow {
  enabled: boolean;
  y: number;
  blur: number;
  opacity: number;
}

/** The bar's shadow as CSS, or nothing when it is off. Unset = the shipped shadow. */
export function headerShadowCss(shadow: HeaderShadow | undefined): string | undefined {
  const value = shadow ?? DEFAULT_HEADER_SHADOW;
  if (!value.enabled || value.opacity <= 0) return undefined;
  return `0 ${value.y}px ${value.blur}px rgba(15, 23, 42, ${value.opacity / 100})`;
}

/** The shadow the bar always had: 2px down, 10px soft, 6%. */
const DEFAULT_HEADER_SHADOW: HeaderShadow = { enabled: true, y: 2, blur: 10, opacity: 6 };

const HEADER_LOGO_VARIANTS = ["auto", "light", "dark"] as const;
export type HeaderLogoVariant = (typeof HEADER_LOGO_VARIANTS)[number];

/**
 * How the "All Categories" trigger paints itself. Fill and border are separate
 * axes on purpose — a merchant can want a solid button with no outline, or a
 * bare label with only a hairline around it, and folding both into one enum
 * would need a combinatorial list of styles.
 */
export type CategoryTriggerStyle = "filled" | "outline" | "soft" | "ghost";

export type CategoryTriggerIcon = "menu" | "grid" | "list";

export type CategoryTriggerOpenOn = "hover" | "click";

export interface CategoryTriggerColorScheme {
  backgroundColor: string;
  textColor: string;
  borderColor: string;
}

export interface CategoryTriggerSettings {
  style: CategoryTriggerStyle;
  borderRadius: number;
  borderWidth: number;
  /**
   * The rail below the button is sized from this, not the other way round —
   * the two are one card and a mismatch shows as a visible step.
   */
  width: number;
  height: number;
  showIcon: boolean;
  icon: CategoryTriggerIcon;
  showChevron: boolean;
  openOn: CategoryTriggerOpenOn;
  /**
   * Drops the category rail open on the storefront home page. Mega menu only —
   * it is the rail that earns its keep sitting open, not the flat category
   * popover.
   */
  openOnHome: boolean;
  /**
   * Off by default so the button keeps tracking the store's theme primary. A
   * hex baked in as the default would freeze the button at one colour while the
   * rest of the storefront follows a theme change.
   */
  useCustomColors: boolean;
  colors: {
    light: CategoryTriggerColorScheme;
    dark: CategoryTriggerColorScheme;
  };
}

export interface HeaderSettings {
  /**
   * The Header Studio layout tree — rows, columns and the items inside them.
   * Every store has one (the normalizer seeds the classic preset), so the
   * studio never opens onto an empty canvas.
   */
  builder: HeaderLayout;
  layout: {
    sticky: boolean;
    fullWidth: boolean;
    variant: HeaderStyleVariant;
    /**
     * Overall bar paint. "transparent" ignores the custom background colors
     * (text colors still apply); "color" paints the theme primary.
     */
    color: HeaderColorMode;
    /**
     * Float the bar over the HOME page's first section, so a full-bleed hero
     * runs under it. The bar keeps its slot in the flow and is pulled back
     * out with a negative margin, so nothing reflows when its paint changes
     * on scroll — it is transparent at the top and returns to the configured
     * bar as soon as the page moves.
     *
     * Home only: every other page opens on content rather than artwork, and
     * a floating bar there would sit on top of the first heading.
     */
    overlapHome: boolean;
    /** The surface the floating bar sits on, which decides its ink. */
    overlapTone: HeaderOverlapTone;
    /**
     * A soft fade behind the floating bar, 0–100: the strength at the top
     * edge of a gradient in the hero tone's shadow (black over a dark hero,
     * white over a light one) that fades out under the bar, so the menu
     * reads over a busy picture. 0 draws nothing.
     */
    overlapScrim: number;
    /** The drop shadow under the bar; see HeaderShadow. */
    shadow: HeaderShadow;
  };
  brand: {
    logoUrl: string;
    darkLogoUrl: string;
    logoAlt: string;
    desktopLogoWidth: number;
    mobileLogoWidth: number;
    /**
     * Which artwork the "color" bar shows. Defaults to the inverse logo: a
     * color bar is the store's primary, and brand primaries are dark far
     * more often than not.
     */
    colorModeLogo: HeaderLogoVariant;
    /** Which artwork the "transparent" bar shows; follows the theme by default. */
    transparentModeLogo: HeaderLogoVariant;
  };
  colors: {
    light: HeaderColorScheme;
    dark: HeaderColorScheme;
  };
  search: {
    enabled: boolean;
    showAiButton: boolean;
    /** A category scope dropdown inside the search pill (desktop). */
    showCategoryDropdown: boolean;
    placeholder: string;
    desktopWidth: number;
    height: number;
    borderRadius: number;
    borderColor: string;
  };
  market: {
    showLanguageSelector: boolean;
    showCurrencySelector: boolean;
    defaultLanguage: string;
    defaultCurrency: string;
  };
  mobile: {
    showSearch: boolean;
    showAccountSummary: boolean;
    showCategoryShortcuts: boolean;
    showCollections: boolean;
    showMarketSelectors: boolean;
    showThemeSelector: boolean;
  };
  widgets: {
    showThemeToggle: boolean;
    showAccountMenu: boolean;
    showWishlist: boolean;
    showCart: boolean;
    /**
     * Shopper location. Off by default: it only earns its place in a
     * marketplace whose vendors are spread across cities — in a single-city
     * store it would just narrow the catalogue to itself.
     *
     * The one switch behind every location surface: the header's "Deliver to"
     * control (attached to the search bar, see `headerLocationSlot`), the
     * Location group and "Pickup near me" facet on the listing sidebars, and
     * checkout's use of the place — city pre-filled, nearest collection point
     * first. Edited from Header Studio.
     */
    showLocationPicker: boolean;
    /** A contact-page shortcut button in the actions cluster. */
    showContact: boolean;
    /** A product-compare shortcut button in the actions cluster. */
    showCompare: boolean;
    /** Tiny text labels under the icon-only action buttons. */
    showLabels: boolean;
    /** Desktop gap between action buttons, px. */
    gap: number;
  };
  categoryMenu: {
    enabled: boolean;
    position: HeaderNavPosition;
    showMegaMenu: boolean;
    showQuickLinks: boolean;
    label: string;
    quickLimit: number;
    mobileLimit: number;
    showPromoCard: boolean;
    promoTitle: string;
    promoSubtitle: string;
    promoImageSrc: string;
    promoHref: string;
    trigger: CategoryTriggerSettings;
  };
  collectionsMenu: {
    enabled: boolean;
    position: HeaderNavPosition;
    label: string;
    limit: number;
  };
  utilityMenu: {
    enabled: boolean;
    /**
     * Which row carries the utility/pages links:
     * - "menu":   with the menu links, wherever the template puts them
     * - "search": right after the search bar, before the action buttons
     * - "tags":   the bottom strip, right-aligned after the top tags
     * Never to the right of the cart/actions cluster.
     */
    placement: HeaderUtilityPlacement;
  };
  pagesMenu: {
    enabled: boolean;
    appPagePaths: string[];
    pageKeys: string[];
    customPageIds: string[];
    order: string[];
    positions: Record<string, HeaderNavPosition>;
  };
}

/**
 * Exported so the storefront and the builder preview can style the trigger
 * before a store has ever saved a header, without cloning the whole settings
 * tree on every render.
 */
export const DEFAULT_CATEGORY_TRIGGER: CategoryTriggerSettings = {
  style: "filled",
  borderRadius: 10,
  borderWidth: 0,
  width: 232,
  height: 42,
  showIcon: true,
  icon: "menu",
  showChevron: true,
  openOn: "hover",
  openOnHome: false,
  useCustomColors: false,
  colors: {
    light: {
      backgroundColor: "#4f46e5",
      textColor: "#ffffff",
      borderColor: "#4f46e5",
    },
    dark: {
      backgroundColor: "#6366f1",
      textColor: "#ffffff",
      borderColor: "#6366f1",
    },
  },
};

const DEFAULT_HEADER_SETTINGS: HeaderSettings = {
  // A getter, not a literal: the layout tree carries generated ids, so each
  // clone (cloneDefaults JSON round-trips this object) has to build its own.
  get builder() {
    return getDefaultHeaderLayout();
  },
  layout: {
    sticky: true,
    fullWidth: false,
    variant: "classic",
    color: "light",
    overlapHome: false,
    overlapTone: "dark",
    overlapScrim: 0,
    shadow: { ...DEFAULT_HEADER_SHADOW },
  },
  brand: {
    logoUrl: "",
    darkLogoUrl: "",
    logoAlt: "",
    desktopLogoWidth: 144,
    mobileLogoWidth: 112,
    colorModeLogo: "dark",
    transparentModeLogo: "auto",
  },
  colors: {
    light: {
      backgroundColor: "#ffffff",
      textColor: "#111827",
      searchBackgroundColor: "#ffffff",
      searchTextColor: "#111827",
    },
    dark: {
      backgroundColor: "#050505",
      textColor: "#ffffff",
      searchBackgroundColor: "#111111",
      searchTextColor: "#ffffff",
    },
  },
  search: {
    enabled: true,
    showAiButton: true,
    showCategoryDropdown: false,
    placeholder: "Search products...",
    desktopWidth: 640,
    height: 40,
    borderRadius: 999,
    borderColor: "#dddddd",
  },
  market: {
    showLanguageSelector: true,
    showCurrencySelector: true,
    defaultLanguage: "en",
    defaultCurrency: "USD",
  },
  widgets: {
    showThemeToggle: true,
    showAccountMenu: true,
    showWishlist: true,
    showCart: true,
    showLocationPicker: false,
    showContact: false,
    showCompare: false,
    showLabels: false,
    gap: 24,
  },
  categoryMenu: {
    enabled: true,
    position: "left",
    showMegaMenu: true,
    showQuickLinks: true,
    label: "All Categories",
    quickLimit: 3,
    mobileLimit: 8,
    showPromoCard: false,
    promoTitle: "",
    promoSubtitle: "",
    promoImageSrc: "",
    promoHref: "",
    trigger: { ...DEFAULT_CATEGORY_TRIGGER },
  },
  collectionsMenu: {
    enabled: true,
    position: "left",
    label: "Collections",
    limit: 12,
  },
  utilityMenu: {
    enabled: true,
    placement: "menu",
  },
  pagesMenu: {
    enabled: true,
    appPagePaths: ["/blog", "/track-order"],
    pageKeys: [],
    customPageIds: [],
    order: ["app:/blog", "app:/track-order"],
    positions: {
      "app:/blog": "right",
      "app:/track-order": "right",
    },
  },
  mobile: {
    showSearch: true,
    showAccountSummary: true,
    showCategoryShortcuts: true,
    showCollections: true,
    showMarketSelectors: true,
    showThemeSelector: true,
  },
};

function cloneDefaults(): HeaderSettings {
  return JSON.parse(JSON.stringify(DEFAULT_HEADER_SETTINGS)) as HeaderSettings;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePosition(value: unknown, fallback: HeaderNavPosition) {
  return value === "left" || value === "right" ? value : fallback;
}

function normalizeHeaderVariant(
  value: unknown,
  fallback: HeaderStyleVariant,
): HeaderStyleVariant {
  if (
    typeof value === "string" &&
    (HEADER_STYLE_VARIANTS as readonly string[]).includes(value)
  ) {
    return value as HeaderStyleVariant;
  }
  if (typeof value === "string" && value in LEGACY_HEADER_VARIANTS) {
    return LEGACY_HEADER_VARIANTS[value];
  }
  return fallback;
}

function normalizeHeaderColorMode(
  value: unknown,
  fallback: HeaderColorMode,
): HeaderColorMode {
  return typeof value === "string" &&
    (HEADER_COLOR_MODES as readonly string[]).includes(value)
    ? (value as HeaderColorMode)
    : fallback;
}

function normalizeHeaderLogoVariant(
  value: unknown,
  fallback: HeaderLogoVariant,
): HeaderLogoVariant {
  return typeof value === "string" &&
    (HEADER_LOGO_VARIANTS as readonly string[]).includes(value)
    ? (value as HeaderLogoVariant)
    : fallback;
}

function normalizeHeaderShadow(value: unknown, fallback: HeaderShadow): HeaderShadow {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    enabled: normalizeBoolean(raw.enabled, fallback.enabled),
    y: normalizeLimit(raw.y, fallback.y, 0, 24),
    blur: normalizeLimit(raw.blur, fallback.blur, 0, 60),
    opacity: normalizeLimit(raw.opacity, fallback.opacity, 0, 100),
  };
}

function normalizeLimit(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizePositionRecord(
  value: unknown,
): Record<string, HeaderNavPosition> {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, position]) => {
      if (position !== "left" && position !== "right") return [];
      const normalizedKey = key.trim();
      return normalizedKey ? [[normalizedKey, position]] : [];
    }),
  );
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)
    ? trimmed
    : fallback;
}

function normalizeColorScheme(
  value: unknown,
  fallback: HeaderColorScheme,
): HeaderColorScheme {
  const source = isRecord(value) ? value : {};

  return {
    backgroundColor: normalizeHexColor(
      source.backgroundColor,
      fallback.backgroundColor,
    ),
    textColor: normalizeHexColor(source.textColor, fallback.textColor),
    searchBackgroundColor: normalizeHexColor(
      source.searchBackgroundColor,
      fallback.searchBackgroundColor,
    ),
    searchTextColor: normalizeHexColor(
      source.searchTextColor,
      fallback.searchTextColor,
    ),
  };
}

function normalizeTriggerStyle(
  value: unknown,
  fallback: CategoryTriggerStyle,
): CategoryTriggerStyle {
  return value === "filled" ||
    value === "outline" ||
    value === "soft" ||
    value === "ghost"
    ? value
    : fallback;
}

function normalizeTriggerIcon(
  value: unknown,
  fallback: CategoryTriggerIcon,
): CategoryTriggerIcon {
  return value === "menu" || value === "grid" || value === "list"
    ? value
    : fallback;
}

function normalizeTriggerOpenOn(
  value: unknown,
  fallback: CategoryTriggerOpenOn,
): CategoryTriggerOpenOn {
  return value === "hover" || value === "click" ? value : fallback;
}

function normalizeTriggerColorScheme(
  value: unknown,
  fallback: CategoryTriggerColorScheme,
): CategoryTriggerColorScheme {
  const source = isRecord(value) ? value : {};

  return {
    backgroundColor: normalizeHexColor(
      source.backgroundColor,
      fallback.backgroundColor,
    ),
    textColor: normalizeHexColor(source.textColor, fallback.textColor),
    borderColor: normalizeHexColor(source.borderColor, fallback.borderColor),
  };
}

function normalizeCategoryTrigger(
  value: unknown,
  fallback: CategoryTriggerSettings,
): CategoryTriggerSettings {
  const source = isRecord(value) ? value : {};
  const colors = isRecord(source.colors) ? source.colors : {};

  return {
    style: normalizeTriggerStyle(source.style, fallback.style),
    borderRadius: normalizeLimit(
      source.borderRadius,
      fallback.borderRadius,
      0,
      999,
    ),
    borderWidth: normalizeLimit(source.borderWidth, fallback.borderWidth, 0, 4),
    // Floor: the label plus both glyphs stop fitting much under 180px. Ceiling:
    // the rail shares this width and the flyout has to survive beside it.
    width: normalizeLimit(source.width, fallback.width, 180, 340),
    height: normalizeLimit(source.height, fallback.height, 34, 56),
    showIcon: normalizeBoolean(source.showIcon, fallback.showIcon),
    icon: normalizeTriggerIcon(source.icon, fallback.icon),
    showChevron: normalizeBoolean(source.showChevron, fallback.showChevron),
    openOn: normalizeTriggerOpenOn(source.openOn, fallback.openOn),
    openOnHome: normalizeBoolean(source.openOnHome, fallback.openOnHome),
    useCustomColors: normalizeBoolean(
      source.useCustomColors,
      fallback.useCustomColors,
    ),
    colors: {
      light: normalizeTriggerColorScheme(colors.light, fallback.colors.light),
      dark: normalizeTriggerColorScheme(colors.dark, fallback.colors.dark),
    },
  };
}

export function getDefaultHeaderSettings(): HeaderSettings {
  return cloneDefaults();
}

export function normalizeHeaderSettings(value: unknown): HeaderSettings {
  const defaults = cloneDefaults();
  const source = isRecord(value) ? value : {};

  const layout = isRecord(source.layout) ? source.layout : {};
  const brand = isRecord(source.brand) ? source.brand : {};
  const colors = isRecord(source.colors) ? source.colors : {};
  const legacyLightColors = {
    backgroundColor: colors.backgroundColor,
    textColor: colors.textColor,
    searchBackgroundColor: colors.searchBackgroundColor,
    searchTextColor: colors.searchTextColor,
  };
  const search = isRecord(source.search) ? source.search : {};
  const market = isRecord(source.market) ? source.market : {};
  const mobile = isRecord(source.mobile) ? source.mobile : {};
  const widgets = isRecord(source.widgets) ? source.widgets : {};
  const categoryMenu = isRecord(source.categoryMenu) ? source.categoryMenu : {};
  const collectionsMenu = isRecord(source.collectionsMenu)
    ? source.collectionsMenu
    : {};
  const utilityMenu = isRecord(source.utilityMenu) ? source.utilityMenu : {};
  const pagesMenu = isRecord(source.pagesMenu) ? source.pagesMenu : {};

  return {
    builder: resolveHeaderLayout(source.builder),
    layout: {
      sticky: normalizeBoolean(layout.sticky, defaults.layout.sticky),
      fullWidth: normalizeBoolean(layout.fullWidth, defaults.layout.fullWidth),
      variant: normalizeHeaderVariant(layout.variant, defaults.layout.variant),
      color: normalizeHeaderColorMode(
        layout.color,
        // Pre-redesign saves carried a `transparent` boolean instead of the
        // color mode — honor it so glass headers stay glass.
        layout.transparent === true ? "transparent" : defaults.layout.color,
      ),
      overlapHome: normalizeBoolean(
        layout.overlapHome,
        defaults.layout.overlapHome,
      ),
      overlapTone: HEADER_OVERLAP_TONES.includes(
        layout.overlapTone as HeaderOverlapTone,
      )
        ? (layout.overlapTone as HeaderOverlapTone)
        : defaults.layout.overlapTone,
      overlapScrim: normalizeLimit(
        layout.overlapScrim,
        defaults.layout.overlapScrim,
        0,
        100,
      ),
      shadow: normalizeHeaderShadow(layout.shadow, defaults.layout.shadow),
    },
    brand: {
      logoUrl: defaults.brand.logoUrl,
      darkLogoUrl: defaults.brand.darkLogoUrl,
      logoAlt: normalizeString(brand.logoAlt, defaults.brand.logoAlt),
      desktopLogoWidth: normalizeLimit(
        brand.desktopLogoWidth,
        defaults.brand.desktopLogoWidth,
        80,
        260,
      ),
      mobileLogoWidth: normalizeLimit(
        brand.mobileLogoWidth,
        defaults.brand.mobileLogoWidth,
        72,
        180,
      ),
      colorModeLogo: normalizeHeaderLogoVariant(
        brand.colorModeLogo,
        defaults.brand.colorModeLogo,
      ),
      transparentModeLogo: normalizeHeaderLogoVariant(
        brand.transparentModeLogo,
        defaults.brand.transparentModeLogo,
      ),
    },
    colors: {
      light: normalizeColorScheme(
        isRecord(colors.light) ? colors.light : legacyLightColors,
        defaults.colors.light,
      ),
      dark: normalizeColorScheme(colors.dark, defaults.colors.dark),
    },
    search: {
      enabled: normalizeBoolean(search.enabled, defaults.search.enabled),
      showAiButton: normalizeBoolean(
        search.showAiButton,
        defaults.search.showAiButton,
      ),
      showCategoryDropdown: normalizeBoolean(
        search.showCategoryDropdown,
        defaults.search.showCategoryDropdown,
      ),
      placeholder: normalizeString(
        search.placeholder,
        defaults.search.placeholder,
      ),
      desktopWidth: normalizeLimit(
        search.desktopWidth,
        defaults.search.desktopWidth,
        360,
        900,
      ),
      height: normalizeLimit(search.height, defaults.search.height, 34, 52),
      borderRadius: normalizeLimit(
        search.borderRadius,
        defaults.search.borderRadius,
        0,
        999,
      ),
      borderColor: normalizeHexColor(
        search.borderColor,
        defaults.search.borderColor,
      ),
    },
    market: {
      showLanguageSelector: normalizeBoolean(
        market.showLanguageSelector,
        defaults.market.showLanguageSelector,
      ),
      showCurrencySelector: normalizeBoolean(
        market.showCurrencySelector,
        defaults.market.showCurrencySelector,
      ),
      defaultLanguage: normalizeString(
        market.defaultLanguage,
        defaults.market.defaultLanguage,
      ).toLowerCase(),
      defaultCurrency: normalizeString(
        market.defaultCurrency,
        defaults.market.defaultCurrency,
      ).toUpperCase(),
    },
    mobile: {
      showSearch: normalizeBoolean(
        mobile.showSearch,
        defaults.mobile.showSearch,
      ),
      showAccountSummary: normalizeBoolean(
        mobile.showAccountSummary,
        defaults.mobile.showAccountSummary,
      ),
      showCategoryShortcuts: normalizeBoolean(
        mobile.showCategoryShortcuts,
        defaults.mobile.showCategoryShortcuts,
      ),
      showCollections: normalizeBoolean(
        mobile.showCollections,
        defaults.mobile.showCollections,
      ),
      showMarketSelectors: normalizeBoolean(
        mobile.showMarketSelectors,
        defaults.mobile.showMarketSelectors,
      ),
      showThemeSelector: normalizeBoolean(
        mobile.showThemeSelector,
        defaults.mobile.showThemeSelector,
      ),
    },
    widgets: {
      showThemeToggle: normalizeBoolean(
        widgets.showThemeToggle,
        defaults.widgets.showThemeToggle,
      ),
      showAccountMenu: normalizeBoolean(
        widgets.showAccountMenu,
        defaults.widgets.showAccountMenu,
      ),
      showWishlist: normalizeBoolean(
        widgets.showWishlist,
        defaults.widgets.showWishlist,
      ),
      showCart: normalizeBoolean(widgets.showCart, defaults.widgets.showCart),
      showLocationPicker: normalizeBoolean(
        widgets.showLocationPicker,
        defaults.widgets.showLocationPicker,
      ),
      showContact: normalizeBoolean(
        widgets.showContact,
        defaults.widgets.showContact,
      ),
      showCompare: normalizeBoolean(
        widgets.showCompare,
        defaults.widgets.showCompare,
      ),
      showLabels: normalizeBoolean(
        widgets.showLabels,
        defaults.widgets.showLabels,
      ),
      gap: normalizeLimit(widgets.gap, defaults.widgets.gap, 12, 40),
    },
    categoryMenu: {
      enabled: normalizeBoolean(
        categoryMenu.enabled,
        defaults.categoryMenu.enabled,
      ),
      position: normalizePosition(
        categoryMenu.position,
        defaults.categoryMenu.position,
      ),
      showMegaMenu: normalizeBoolean(
        categoryMenu.showMegaMenu,
        defaults.categoryMenu.showMegaMenu,
      ),
      showQuickLinks: normalizeBoolean(
        categoryMenu.showQuickLinks,
        defaults.categoryMenu.showQuickLinks,
      ),
      label: normalizeString(categoryMenu.label, defaults.categoryMenu.label),
      quickLimit: normalizeLimit(
        categoryMenu.quickLimit,
        defaults.categoryMenu.quickLimit,
        0,
        24,
      ),
      mobileLimit: normalizeLimit(
        categoryMenu.mobileLimit,
        defaults.categoryMenu.mobileLimit,
        0,
        16,
      ),
      showPromoCard: normalizeBoolean(
        categoryMenu.showPromoCard,
        defaults.categoryMenu.showPromoCard,
      ),
      promoTitle: normalizeString(
        categoryMenu.promoTitle,
        defaults.categoryMenu.promoTitle,
      ),
      promoSubtitle: normalizeString(
        categoryMenu.promoSubtitle,
        defaults.categoryMenu.promoSubtitle,
      ),
      promoImageSrc: normalizeString(
        categoryMenu.promoImageSrc,
        defaults.categoryMenu.promoImageSrc,
      ),
      promoHref: normalizeString(
        categoryMenu.promoHref,
        defaults.categoryMenu.promoHref,
      ),
      trigger: normalizeCategoryTrigger(
        categoryMenu.trigger,
        defaults.categoryMenu.trigger,
      ),
    },
    collectionsMenu: {
      enabled: normalizeBoolean(
        collectionsMenu.enabled,
        defaults.collectionsMenu.enabled,
      ),
      position: normalizePosition(
        collectionsMenu.position,
        defaults.collectionsMenu.position,
      ),
      label: normalizeString(
        collectionsMenu.label,
        defaults.collectionsMenu.label,
      ),
      limit: normalizeLimit(
        collectionsMenu.limit,
        defaults.collectionsMenu.limit,
        0,
        24,
      ),
    },
    utilityMenu: {
      enabled: normalizeBoolean(
        utilityMenu.enabled,
        defaults.utilityMenu.enabled,
      ),
      placement:
        typeof utilityMenu.placement === "string" &&
        (HEADER_UTILITY_PLACEMENTS as readonly string[]).includes(
          utilityMenu.placement,
        )
          ? (utilityMenu.placement as HeaderUtilityPlacement)
          : defaults.utilityMenu.placement,
    },
    pagesMenu: {
      enabled: normalizeBoolean(pagesMenu.enabled, defaults.pagesMenu.enabled),
      appPagePaths: Array.isArray(pagesMenu.appPagePaths)
        ? normalizeStringArray(pagesMenu.appPagePaths)
        : defaults.pagesMenu.appPagePaths,
      pageKeys: Array.isArray(pagesMenu.pageKeys)
        ? normalizeStringArray(pagesMenu.pageKeys)
        : defaults.pagesMenu.pageKeys,
      customPageIds: Array.isArray(pagesMenu.customPageIds)
        ? normalizeStringArray(pagesMenu.customPageIds)
        : defaults.pagesMenu.customPageIds,
      order: Array.isArray(pagesMenu.order)
        ? normalizeStringArray(pagesMenu.order)
        : defaults.pagesMenu.order,
      positions: {
        ...defaults.pagesMenu.positions,
        ...normalizePositionRecord(pagesMenu.positions),
      },
    },
  };
}

/** A logo's width in px on each side of the header's `lg` breakpoint. */
export interface LogoWidths {
  /** From `lg` up. */
  desktop: number;
  /** Below `lg`. */
  mobile: number;
}

/**
 * The widths the storefront header draws the logo at: its layout's brand
 * item from `lg` up (the studio's Size — the scroll size is only a transient
 * state), and the compact bar's width below. The footer's "same size as the
 * header" reads these, so the two logos stay equal whichever one is edited.
 */
export function headerLogoWidths(header: HeaderSettings): LogoWidths {
  return {
    desktop: headerBrandItem(header.builder)?.size ?? DEFAULT_HEADER_LOGO_SIZE,
    mobile: header.brand.mobileLogoWidth,
  };
}

/**
 * Which logo the header bar paints, resolved ONCE for both surfaces.
 *
 * The storefront header and the admin's Header style preview must agree
 * exactly — a preview that shows the inverse logo while the live bar shows
 * the primary one is a preview the merchant cannot trust. They used to
 * decide independently (the preview keyed off the paint mode, the storefront
 * off the shopper's theme), so this is the single rule both now call.
 *
 * `light`/`dark` name the ARTWORK. The dark artwork is only ever chosen when
 * one has actually been uploaded; otherwise the primary logo stands in,
 * because a missing logo reads as a broken store where a slightly
 * low-contrast one merely reads as plain.
 */
export function resolveHeaderLogoUrl({
  colorMode,
  brand,
  isDark,
  lightLogoUrl,
  darkLogoUrl,
}: {
  colorMode: HeaderColorMode;
  brand: Pick<
    HeaderSettings["brand"],
    "colorModeLogo" | "transparentModeLogo"
  >;
  /** The shopper's (or preview's) active theme. */
  isDark: boolean;
  lightLogoUrl: string;
  darkLogoUrl: string;
}): string {
  const variant: HeaderLogoVariant =
    colorMode === "color"
      ? brand.colorModeLogo
      : colorMode === "transparent"
        ? brand.transparentModeLogo
        : // Neither needs a setting of its own: "dark" pins the dark scheme
          // whatever the shopper's theme, so its bar is always dark; "light"
          // is the pair of schemes FOLLOWING the theme, so its logo follows
          // the theme with them.
          colorMode === "dark"
          ? "dark"
          : "auto";

  const wantsDark = variant === "dark" || (variant === "auto" && isDark);
  return (wantsDark && darkLogoUrl.trim() ? darkLogoUrl : lightLogoUrl).trim();
}

/**
 * One rendered navigation entry of the storefront header, as the header,
 * its mega menu and the admin menu builder all see it. Lives here rather than
 * in the header component so `lib/` never depends on `components/`.
 */
export interface HeaderMenuItem {
  label: string;
  href: string;
  target?: "_self" | "_blank";
  icon?: string;
  image?: string;
  description?: string;
  badge?: string;
  isFeatured?: boolean;
  /**
   * Mega menu top-level only: where this category's promo renders. Absent on
   * menus saved before the setting existed — the panel derives those from the
   * legacy `isFeatured` flag.
   */
  promoMode?: "none" | "side" | "bottom";
  /**
   * Mega menu top-level, "bottom" mode only: the pair of images that make the
   * card strip under the link columns. Menus saved before these fields existed
   * built the strip out of children flagged `isFeatured` instead.
   */
  promoImages?: string[];
  columnTitle?: string;
  navPosition?: "left" | "right";
  children?: HeaderMenuItem[];
}
