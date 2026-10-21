import { isValidCssColor, normalizeColorToHex } from "@/lib/site-config/appearance-colors";
import {
  SLIDER_HEIGHTS,
  SLIDER_WIDTHS,
} from "@/lib/storefront/sections/slider-grids";
import { isFontId } from "@/lib/storefront/fonts/catalog";
import { isRecord } from "@/lib/utils";

/**
 * A theme, as data: the complete token set that describes a storefront's
 * look. A manifest supplies every token's DEFAULT (that is what makes
 * Electronics look like Electronics); the merchant's edits are stored per
 * theme as a partial over those defaults; `compileTheme()` turns the merged
 * result into CSS custom properties. Themes carry no CSS of their own.
 *
 * Pure module: the editor generates its controls from `THEME_TOKEN_GROUPS`
 * on the client, the API normalizes writes with it on the server.
 */

/* ------------------------------------------------------------------ */
/* Colors                                                               */
/* ------------------------------------------------------------------ */

/**
 * The color ROLES a theme paints with. Storefront components already read
 * these through the shadcn variables (`bg-background`, `bg-card`,
 * `text-muted-foreground`, `bg-primary`…); `sale`, `rating` and `link` are
 * the three the catalog was missing.
 */
export const COLOR_ROLES = [
  "background",
  "surface",
  "surfaceAlt",
  "text",
  "textMuted",
  "border",
  "primary",
  "onPrimary",
  "secondary",
  "onSecondary",
  "accent",
  "sale",
  "rating",
  "link",
  "onAccent", "accentSurface", "onAccentSurface", "hoverSurface", "onHover",
  "selectedSurface", "onSelected", "focusRing", "fieldBorder",
  "onSale", "saleText", "saleSurface", "onSaleSurface",
  "skeleton",
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/**
 * The roles the Colors editor lists, in the order a merchant reads a page.
 * Every role in COLOR_ROLES is reachable: these rows, the Advanced rows, or
 * the "text on" colours inside a row (ROLE_TEXT_ROLES).
 */
/**
 * The four colours a theme is built from, edited as tiles above the rest:
 * the main buttons, Add to cart, the promo labels and loading placeholders.
 * Each theme owns its own (colour schema 4), so they never leak between
 * themes; the dashboards and emails follow the LIVE theme's.
 */
export const KEY_COLOR_ROLES = ["primary", "secondary", "accent", "skeleton"] as const;
export type KeyColorRole = (typeof KEY_COLOR_ROLES)[number];

/** A key colour's short name, and the storefront part its tile shows it on. */
export const KEY_COLOR_META: Record<KeyColorRole, { label: string; sample?: string }> = {
  primary: { label: "Primary", sample: "Buy now" },
  secondary: { label: "Secondary", sample: "Add to cart" },
  accent: { label: "Accent", sample: "Featured" },
  // Shown as placeholder bars, not on a part with a label.
  skeleton: { label: "Loading" },
};

export const COLOR_ROLE_SECTIONS: { key: string; label: string; roles: ColorRole[] }[] = [
  { key: "page", label: "Page", roles: ["background", "surface", "surfaceAlt"] },
  { key: "text", label: "Text", roles: ["text", "textMuted", "link"] },
  { key: "sales", label: "Sales & ratings", roles: ["sale", "rating"] },
  { key: "lines", label: "Lines", roles: ["border", "fieldBorder"] },
];

export const ADVANCED_COLOR_SECTIONS: { key: string; label: string; roles: ColorRole[] }[] = [
  { key: "states", label: "States", roles: ["hoverSurface", "selectedSurface", "focusRing"] },
  // accentSurface still compiles (to --highlight-surface) so saved values
  // keep loading, but no storefront part paints it: the promo labels take the
  // solid accent. Offering it would be a setting that changes nothing.
  { key: "soft", label: "Soft backgrounds", roles: ["saleSurface"] },
];

/** The text colours that belong to a fill, edited inside that fill's row. */
export const ROLE_TEXT_ROLES: Partial<Record<ColorRole, ColorRole[]>> = {
  primary: ["onPrimary"],
  secondary: ["onSecondary"],
  accent: ["onAccent"],
  sale: ["onSale", "saleText"],
  hoverSurface: ["onHover"],
  selectedSurface: ["onSelected"],
  accentSurface: ["onAccentSurface"],
  saleSurface: ["onSaleSurface"],
};

/**
 * A role's value: a hex color, or "" — the role's own fallback (documented
 * per role in `COLOR_ROLE_META`): the theme's base token for page colors,
 * "same as X" for derived ones. Colour schema 3 also took a brand reference;
 * schema 4 replaced them with the theme's own colours (adoptThemeKeyColors).
 */
export const BRAND_COLOR_REFS = [
  "brand.primary",
  "brand.accent",
] as const;
/**
 * Retired in colour schema 3: the brand no longer has a secondary colour of
 * its own (it painted nothing). A stored reference reads as the theme default.
 */
const RETIRED_BRAND_REFS = ["brand.secondary"];
export type ColorValue = string;

export type ColorScheme = Record<ColorRole, ColorValue>;

/**
 * What the editor calls each role and what it says the role paints. `hint`
 * names the places a shopper sees the colour, so a merchant changing it
 * knows what will move; `fallback` is what "" resolves to.
 */
export const COLOR_ROLE_META: Record<
  ColorRole,
  { label: string; hint: string; fallback: string }
> = {
  background: { label: "Background", hint: "Behind every page.", fallback: "Theme default" },
  surface: { label: "Cards & menus", hint: "Panels, popovers, dropdowns and menus.", fallback: "Same as background" },
  surfaceAlt: { label: "Bands & chips", hint: "Banded sections, image backgrounds and neutral chips.", fallback: "Theme default" },
  text: { label: "Text", hint: "Headings and body copy.", fallback: "Theme default" },
  textMuted: { label: "Secondary text", hint: "Captions, categories, placeholders.", fallback: "Theme default" },
  border: { label: "Dividers", hint: "Lines between sections and around cards.", fallback: "Theme default" },
  primary: { label: "Primary button", hint: "Main buttons, the cart count and active-tab lines.", fallback: "Theme default" },
  onPrimary: { label: "Text on primary", hint: "Labels on primary buttons.", fallback: "Auto (readable)" },
  secondary: { label: "Secondary button", hint: "Add to cart and the other second buttons.", fallback: "Same as text" },
  onSecondary: { label: "Text on secondary", hint: "The label on Add to cart.", fallback: "Auto (readable)" },
  accent: { label: "Accent", hint: "The Featured label on product cards and badges in the store menu.", fallback: "Theme default" },
  sale: { label: "Sale", hint: "Discount badges and sale prices.", fallback: "Theme default (red)" },
  rating: { label: "Rating stars", hint: "Review stars.", fallback: "Theme default (amber)" },
  link: { label: "Links", hint: "Links, \"View all\" and the active menu item: text in the primary colour, kept readable.", fallback: "Primary, made readable" },
  onAccent: { label: "Text on accent", hint: "Labels on the accent colour.", fallback: "Auto (readable)" },
  accentSurface: { label: "Accent background", hint: "A soft tint of the accent behind promotional text.", fallback: "Auto" },
  onAccentSurface: { label: "Text on accent background", hint: "Text on the accent tint.", fallback: "Auto (readable)" },
  hoverSurface: { label: "Hover background", hint: "Menus and buttons under the pointer.", fallback: "Auto" },
  onHover: { label: "Text on hover", hint: "Labels on the hover background.", fallback: "Auto (readable)" },
  selectedSurface: { label: "Selected background", hint: "Checked items in dropdowns and the active row in menus.", fallback: "Auto" },
  onSelected: { label: "Text on selected", hint: "Labels on the selected background.", fallback: "Auto (readable)" },
  focusRing: { label: "Focus ring", hint: "The outline keyboard users follow.", fallback: "Auto" },
  fieldBorder: { label: "Input borders", hint: "Checkout fields, forms and dropdowns. The header search box has its own border in Header Studio.", fallback: "Auto (readable)" },
  onSale: { label: "Text on sale", hint: "Labels on solid discount badges.", fallback: "Auto (readable)" },
  saleText: { label: "Sale text", hint: "Sale prices and savings on the page.", fallback: "Auto (readable)" },
  saleSurface: { label: "Sale background", hint: "Behind the discount chips beside prices.", fallback: "Auto" },
  onSaleSurface: { label: "Text on sale background", hint: "Text on the sale tint.", fallback: "Auto (readable)" },
  skeleton: { label: "Loading placeholder", hint: "The grey blocks shown while a page loads.", fallback: "Theme default" },
};

const DARK_MODES = ["auto", "custom"] as const;
export type DarkMode = (typeof DARK_MODES)[number];

/* ------------------------------------------------------------------ */
/* The token set                                                        */
/* ------------------------------------------------------------------ */

export const PAGE_WIDTHS = ["1200", "1280", "1440", "full"] as const;
export const HEADING_TRANSFORMS = ["none", "uppercase"] as const;
export const BUTTON_FONTS = ["body", "heading"] as const;
export const SHADOWS = ["none", "soft", "medium"] as const;
export const BUTTON_HOVERS = ["none", "darken", "lift"] as const;
const FONT_WEIGHTS = ["400", "500", "600", "700", "800"] as const;

export interface ThemeTokens {
  colors: {
    /**
     * 3: a primary/accent left on "" (or naming the brand) follows the one
     * store-wide brand. 4: the theme owns its key colours; "" is the theme's
     * own default and brand references are gone (see adoptThemeKeyColors).
     */
    schemaVersion: 3 | 4;
    light: ColorScheme;
    /** Read only when `darkMode` is "custom"; "auto" derives from light. */
    dark: ColorScheme;
    darkMode: DarkMode;
  };
  type: {
    /** Catalog id, or "" for the theme's own default. */
    headingFont: string;
    bodyFont: string;
    headingWeight: string;
    /** em */
    headingTracking: number;
    headingTransform: (typeof HEADING_TRANSFORMS)[number];
    buttonFont: (typeof BUTTON_FONTS)[number];
    buttonWeight: string;
    buttonTransform: (typeof HEADING_TRANSFORMS)[number];
    /** em */
    buttonTracking: number;
  };
  layout: {
    pageWidth: (typeof PAGE_WIDTHS)[number];
    /** px — horizontal inset of every section when the page is full width. */
    pagePadding: number;
    sliderWidth: string;
    sliderHeight: string;
    /** How the shop's own scrollbar is drawn — see SCROLLBAR_STYLES. */
    scrollbar: (typeof SCROLLBAR_STYLES)[number]["key"];
    /** The handle's colour; "" takes the theme's border. */
    scrollbarThumb: string;
    /** The groove behind it; "" leaves it transparent. */
    scrollbarTrack: string;
  };
  shape: {
    /** px */
    cardRadius: number;
    /** px, or "" = match cards */
    buttonRadius: number | "";
    /** px, or "" = match buttons */
    inputRadius: number | "";
    /** px */
    badgeRadius: number;
    /** px */
    cardBorder: number;
    /** px */
    inputBorder: number;
    cardShadow: (typeof SHADOWS)[number];
    overlayShadow: (typeof SHADOWS)[number];
  };
  buttons: {
    /** px */
    height: number;
    hover: (typeof BUTTON_HOVERS)[number];
  };
}

export type ThemeGroupKey = keyof ThemeTokens;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ThemeTokenOverrides = DeepPartial<ThemeTokens>;

const EMPTY_SCHEME = Object.fromEntries(
  COLOR_ROLES.map((role) => [role, ""]),
) as ColorScheme;

/**
 * The engine's base look. A manifest overrides what makes it a different
 * theme; everything else comes from here. Colors default to "" so the
 * storefront's own tokens (and the brand palette) stay in charge until a
 * merchant or a preset says otherwise.
 */
export const BASE_THEME_TOKENS: ThemeTokens = {
  colors: { schemaVersion: 3, light: { ...EMPTY_SCHEME }, dark: { ...EMPTY_SCHEME }, darkMode: "auto" },
  type: {
    headingFont: "",
    bodyFont: "",
    headingWeight: "700",
    headingTracking: -0.02,
    headingTransform: "none",
    buttonFont: "body",
    buttonWeight: "600",
    buttonTransform: "none",
    buttonTracking: 0,
  },
  layout: {
    pageWidth: "1280",
    pagePadding: 16,
    sliderWidth: "fixed",
    sliderHeight: "half",
    scrollbar: "thin",
    scrollbarThumb: "",
    scrollbarTrack: "",
  },
  shape: {
    cardRadius: 16,
    buttonRadius: "",
    inputRadius: "",
    badgeRadius: 999,
    cardBorder: 1,
    inputBorder: 1,
    cardShadow: "none",
    overlayShadow: "medium",
  },
  buttons: { height: 36, hover: "darken" },
};

/* ------------------------------------------------------------------ */
/* Schema — what the editor generates its controls from                 */
/* ------------------------------------------------------------------ */

export type TokenFieldKind =
  | "color"
  | "length"
  | "select"
  | "segmented"
  | "font"
  | "picture";

/**
 * How the shop draws its scrollbar.
 *
 * "hidden" reserves nothing, so a full-bleed section reaches the window —
 * a classic bar takes a column out of the viewport and the page paints
 * inside what is left, which showed as a strip of page background beside
 * the hero. What it costs is the drag handle and the position indicator,
 * which is why it is a choice and not the rule.
 */
export const SCROLLBAR_STYLES = [
  { key: "thin", label: "Thin", css: "thin" },
  { key: "standard", label: "Standard", css: "auto" },
  { key: "hidden", label: "Hidden", css: "none" },
] as const;

export interface TokenField {
  key: string;
  kind: TokenFieldKind;
  label: string;
  hint?: string;
  unit?: "px" | "em";
  min?: number;
  max?: number;
  step?: number;
  options?: { key: string; label: string }[];
  /** Label for the "" value when the field may inherit. */
  inherit?: string;
  /** Show only while a sibling field in the group holds this value. */
  when?: { key: string; equals: string };
  /**
   * Part of the theme's own design, not a merchant control: declared so the
   * theme's value is carried through `normalizeThemeTokens` (which merges
   * only DECLARED fields — drop the declaration and the theme silently falls
   * back to the base defaults), but never rendered in the editor.
   */
  themeOnly?: boolean;
  /**
   * For a `color` field OUTSIDE the Colors group: the role its empty value
   * follows, so the swatch can show what "inherit" actually resolves to
   * rather than a blank.
   */
  resolvesTo?: ColorRole;
}

/** Whether a field applies given its group's current values. */
export function isFieldVisible(
  field: TokenField,
  groupValues: Record<string, unknown>,
): boolean {
  if (field.themeOnly) return false;
  return !field.when || groupValues[field.when.key] === field.when.equals;
}

export interface TokenGroup {
  key: ThemeGroupKey;
  label: string;
  description: string;
  fields: TokenField[];
}

const weightOptions = FONT_WEIGHTS.map((weight) => ({
  key: weight,
  label: { "400": "Regular", "500": "Medium", "600": "Semibold", "700": "Bold", "800": "Extra bold" }[weight] ?? weight,
}));
const transformOptions = [
  { key: "none", label: "As typed" },
  { key: "uppercase", label: "UPPERCASE" },
];
const shadowOptions = [
  { key: "none", label: "None" },
  { key: "soft", label: "Soft" },
  { key: "medium", label: "Medium" },
];

export const THEME_TOKEN_GROUPS: TokenGroup[] = [
  {
    key: "colors",
    label: "Colors",
    // {theme}: the theme being edited — its colours are its own.
    description: "Only {theme} uses these colors. Your other themes keep their own.",
    fields: COLOR_ROLES.map((role) => ({
      key: role,
      kind: "color" as const,
      label: COLOR_ROLE_META[role].label,
      hint: COLOR_ROLE_META[role].hint,
      inherit: COLOR_ROLE_META[role].fallback,
    })),
  },
  {
    key: "type",
    label: "Typography",
    description: "Faces and treatment for headings, body copy and buttons.",
    fields: [
      { key: "headingFont", kind: "font", label: "Heading font", inherit: "Theme default" },
      { key: "bodyFont", kind: "font", label: "Body font", inherit: "Theme default" },
      { key: "headingWeight", kind: "select", label: "Heading weight", options: weightOptions },
      { key: "headingTracking", kind: "length", label: "Heading tracking", unit: "em", min: -0.06, max: 0.12, step: 0.01 },
      { key: "headingTransform", kind: "segmented", label: "Heading case", options: transformOptions },
      { key: "buttonFont", kind: "segmented", label: "Button font", options: [{ key: "body", label: "Body" }, { key: "heading", label: "Heading" }] },
      { key: "buttonWeight", kind: "select", label: "Button weight", options: weightOptions },
      { key: "buttonTransform", kind: "segmented", label: "Button case", options: transformOptions },
      { key: "buttonTracking", kind: "length", label: "Button tracking", unit: "em", min: -0.04, max: 0.16, step: 0.01 },
    ],
  },
  {
    key: "layout",
    label: "Layout",
    description: "How wide the content sits, and the space beside it.",
    fields: [
      {
        key: "pageWidth",
        kind: "picture",
        label: "Page width",
        options: [
          { key: "1200", label: "1200 px" },
          { key: "1280", label: "1280 px" },
          { key: "1440", label: "1440 px" },
          { key: "full", label: "Full width" },
        ],
      },
      {
        key: "pagePadding",
        kind: "length",
        label: "Full width padding",
        hint: "Space between the viewport edge and the content on every section.",
        unit: "px",
        min: 0,
        max: 96,
        step: 1,
        when: { key: "pageWidth", equals: "full" },
      },
      {
        key: "scrollbar",
        kind: "segmented",
        label: "Scrollbar",
        hint: "Hidden reserves no space, so a full-bleed section reaches the window — at the cost of the drag handle and the position indicator.",
        options: SCROLLBAR_STYLES.map((style) => ({
          key: style.key,
          label: style.label,
        })),
      },
      {
        key: "scrollbarThumb",
        kind: "color",
        label: "Scrollbar handle",
        inherit: "Border colour",
        resolvesTo: "border",
        when: { key: "scrollbar", equals: "thin" },
      },
      {
        key: "scrollbarTrack",
        kind: "color",
        label: "Scrollbar groove",
        inherit: "Transparent",
        when: { key: "scrollbar", equals: "thin" },
      },
      // The size a slider gets is set on the SECTION that holds it, beside
      // the cell being sized — not once for the whole shop, where it only
      // ever meant "whatever the first hero wanted". These two stay as the
      // theme's own design, which a section set to "theme" inherits.
      {
        key: "sliderWidth",
        kind: "picture",
        label: "Slider width style",
        themeOnly: true,
        options: SLIDER_WIDTHS.map((width) => ({ key: width.key, label: width.label })),
      },
      {
        key: "sliderHeight",
        kind: "picture",
        label: "Slider height",
        themeOnly: true,
        options: SLIDER_HEIGHTS.map((height) => ({ key: height.key, label: height.label })),
      },
    ],
  },
  {
    key: "shape",
    label: "Shapes",
    description: "Corners, borders and elevation. Exact values, in pixels.",
    fields: [
      { key: "cardRadius", kind: "length", label: "Card radius", hint: "Also the base radius every rounded element derives from.", unit: "px", min: 0, max: 32, step: 1 },
      { key: "buttonRadius", kind: "length", label: "Button radius", hint: "999 makes a pill.", unit: "px", min: 0, max: 999, step: 1, inherit: "Match cards" },
      { key: "inputRadius", kind: "length", label: "Input radius", hint: "Search boxes, checkout fields, dropdowns.", unit: "px", min: 0, max: 999, step: 1, inherit: "Match buttons" },
      { key: "badgeRadius", kind: "length", label: "Badge radius", unit: "px", min: 0, max: 999, step: 1 },
      { key: "cardBorder", kind: "length", label: "Card border", unit: "px", min: 0, max: 3, step: 1 },
      { key: "inputBorder", kind: "length", label: "Input border", unit: "px", min: 0, max: 3, step: 1 },
      { key: "cardShadow", kind: "segmented", label: "Card shadow", options: shadowOptions },
      { key: "overlayShadow", kind: "segmented", label: "Overlay shadow", hint: "Dropdowns, popovers, drawers.", options: shadowOptions },
    ],
  },
  {
    key: "buttons",
    label: "Buttons",
    description: "Size and behaviour of action buttons.",
    fields: [
      { key: "height", kind: "length", label: "Height", unit: "px", min: 32, max: 56, step: 1 },
      {
        key: "hover",
        kind: "segmented",
        label: "Hover",
        options: [
          { key: "none", label: "None" },
          { key: "darken", label: "Darken" },
          { key: "lift", label: "Lift" },
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Normalization                                                        */
/* ------------------------------------------------------------------ */

function normalizeColorValue(value: unknown, allowBrandRefs = true): ColorValue {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((BRAND_COLOR_REFS as readonly string[]).includes(trimmed)) return allowBrandRefs ? trimmed : "";
  return isValidCssColor(trimmed) ? trimmed.toLowerCase() : normalizeColorToHex(trimmed) ?? "";
}

function normalizeScheme(raw: unknown, fallback: ColorScheme, allowBrandRefs = true): ColorScheme {
  const source = isRecord(raw) ? raw : {};
  const scheme = { ...fallback };
  for (const role of COLOR_ROLES) {
    if (!(role in source)) continue;
    const value = normalizeColorValue(source[role], allowBrandRefs);
    // "" is a deliberate "use the fallback"; a value that is not a colour at
    // all keeps the THEME's own default rather than the engine base.
    const unreadable = value === "" && typeof source[role] === "string" && source[role].trim() !== "";
    if (!unreadable) scheme[role] = value;
  }
  return scheme;
}

/**
 * Colour schema 3 gave the Secondary role a new job: it used to paint tag
 * chips (now Bands & chips) and paints Add to cart instead, and the brand's
 * own secondary colour was retired. A value saved for the old job would
 * repaint Add to cart, so an older document's Secondary (and any reference to
 * the retired brand secondary) reads as the theme default.
 */
function upgradeColorsToSchema3(colors: Record<string, unknown>): Record<string, unknown> {
  if (typeof colors.schemaVersion === "number" && colors.schemaVersion >= 3) return colors;
  const upgrade = (scheme: unknown) => {
    if (!isRecord(scheme)) return scheme;
    const next: Record<string, unknown> = {};
    for (const [role, value] of Object.entries(scheme)) {
      if (role === "secondary") continue;
      if (typeof value === "string" && RETIRED_BRAND_REFS.includes(value.trim())) continue;
      next[role] = value;
    }
    return next;
  };
  return { ...colors, light: upgrade(colors.light), dark: upgrade(colors.dark) };
}

function normalizeNumber(
  value: unknown,
  field: TokenField,
  fallback: number | "",
): number | "" {
  if (value === "" || value === null) return field.inherit !== undefined ? "" : fallback;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  const min = field.min ?? -Infinity;
  const max = field.max ?? Infinity;
  const clamped = Math.min(max, Math.max(min, number));
  const step = field.step ?? 1;
  const decimals = step < 1 ? String(step).split(".")[1]?.length ?? 2 : 0;
  return Number(clamped.toFixed(decimals));
}

function normalizeField(
  field: TokenField,
  value: unknown,
  fallback: unknown,
): unknown {
  switch (field.kind) {
    case "color":
      // A brand reference was never paintable here (the scrollbar writes the
      // value into CSS as it is); it falls back to the field's own default.
      return normalizeColorValue(value, false);
    case "length":
      return normalizeNumber(value, field, fallback as number | "");
    case "font":
      return isFontId(value) ? value : value === "" ? "" : fallback;
    case "select":
    case "segmented":
    case "picture":
      return field.options?.some((option) => option.key === value)
        ? (value as string)
        : fallback;
  }
}

/**
 * Give a theme its own key colours (colour schema 4). Until 3.1 a theme's
 * primary and accent left on "" — or naming the brand — followed ONE
 * store-wide brand, so changing them for one theme changed every theme.
 * Adopting copies that brand into the theme as its own colours: nothing
 * changes on screen, and from then on each theme is coloured on its own.
 * Light references become the brand's hex; dark ones go back to Auto (they
 * follow light, lifted to show on a dark page).
 */
export function adoptThemeKeyColors(
  tokens: ThemeTokens,
  brand: { primary: string; accent: string; skeleton?: string },
): ThemeTokens {
  if (tokens.colors.schemaVersion === 4) return tokens;
  const hexFor = (value: string) =>
    value === "brand.primary" ? brand.primary : value === "brand.accent" ? brand.accent : RETIRED_BRAND_REFS.includes(value) ? "" : value;
  const light = Object.fromEntries(
    COLOR_ROLES.map((role) => [role, hexFor(tokens.colors.light[role])]),
  ) as ColorScheme;
  if (!light.primary) light.primary = brand.primary;
  if (!light.accent) light.accent = brand.accent;
  if (!light.skeleton && brand.skeleton) light.skeleton = brand.skeleton;
  const dark = Object.fromEntries(
    COLOR_ROLES.map((role) => {
      const value = tokens.colors.dark[role];
      return [role, (BRAND_COLOR_REFS as readonly string[]).includes(value) || RETIRED_BRAND_REFS.includes(value) ? "" : value];
    }),
  ) as ColorScheme;
  return { ...tokens, colors: { ...tokens.colors, schemaVersion: 4, light, dark } };
}

/**
 * A theme's defaults as the editor offers them: its own key colours (schema
 * 4), so "Reset" gives the theme's colours rather than following a brand.
 */
export function ownKeyColorDefaults(defaults: ThemeTokens): ThemeTokens {
  return { ...defaults, colors: { ...defaults.colors, schemaVersion: 4 } };
}

/**
 * The colours as they are STORED: only roles that differ from the theme's own
 * defaults. Readers fill the rest from the theme (`normalizeThemeTokens`), so
 * a later fix to a theme's palette reaches every store that never changed
 * that colour, and the editor can tell a merchant's own colour from the
 * theme's. A role equal to its default is omitted, not "" — "" means "the
 * role's fallback", which for a theme with its own hex is a different colour.
 */
export function storedThemeColors(
  values: ThemeTokens,
  defaults: ThemeTokens,
): Omit<ThemeTokens, "colors"> & {
  colors: Omit<ThemeTokens["colors"], "light" | "dark"> & {
    light: Partial<ColorScheme>;
    dark: Partial<ColorScheme>;
  };
} {
  const own = (scheme: ColorScheme, base: ColorScheme): Partial<ColorScheme> =>
    Object.fromEntries(
      COLOR_ROLES.filter((role) => scheme[role] !== base[role]).map((role) => [role, scheme[role]]),
    );
  return {
    ...values,
    colors: {
      ...values.colors,
      light: own(values.colors.light, defaults.colors.light),
      dark: own(values.colors.dark, defaults.colors.dark),
    },
  };
}

/**
 * Merge overrides over defaults, field by field through the schema. Unknown
 * keys are dropped, malformed values fall back, numbers clamp — a tampered
 * or outdated document can only ever produce tokens the schema describes.
 */
export function normalizeThemeTokens(
  defaults: ThemeTokens,
  overrides: unknown,
  { strict = false }: { strict?: boolean } = {},
): ThemeTokens {
  const source = isRecord(overrides) ? migrateLegacyThemeSettings(overrides) : {};
  // Colors written by a newer engine. A write must refuse them (it would
  // rewrite what it cannot read); a render paints the theme's own colors
  // instead, so a downgraded deployment shows a store rather than a 500.
  const futureColors =
    isRecord(source.colors) &&
    typeof source.colors.schemaVersion === "number" &&
    source.colors.schemaVersion > 4;
  if (futureColors && strict) {
    throw new Error("Unsupported theme color schema version");
  }
  const result = structuredClone(defaults);

  for (const group of THEME_TOKEN_GROUPS) {
    const raw = isRecord(source[group.key]) ? (source[group.key] as Record<string, unknown>) : {};
    if (group.key === "colors") {
      if (futureColors) continue;
      const colors = upgradeColorsToSchema3(raw);
      // A theme that owns its key colours stays so; brand references are
      // not colours there (adoption replaced them).
      const owned = colors.schemaVersion === 4;
      result.colors.schemaVersion = owned ? 4 : 3;
      result.colors.light = normalizeScheme(colors.light, defaults.colors.light, !owned);
      result.colors.dark = normalizeScheme(colors.dark, defaults.colors.dark, !owned);
      result.colors.darkMode = (DARK_MODES as readonly string[]).includes(colors.darkMode as string)
        ? (colors.darkMode as DarkMode)
        : defaults.colors.darkMode;
      continue;
    }
    const target = result[group.key] as unknown as Record<string, unknown>;
    const fallbackGroup = defaults[group.key] as unknown as Record<string, unknown>;
    for (const field of group.fields) {
      if (field.key in raw) {
        target[field.key] = normalizeField(field, raw[field.key], fallbackGroup[field.key]);
      }
    }
  }
  return result;
}

/** Deep-merge a manifest's partial tokens over the engine base. */
export function resolveThemeDefaults(overrides?: ThemeTokenOverrides): ThemeTokens {
  return normalizeThemeTokens(BASE_THEME_TOKENS, overrides ?? {});
}

/* ------------------------------------------------------------------ */
/* Legacy migration                                                     */
/* ------------------------------------------------------------------ */

const LEGACY_KEYS = [
  "containerWidth",
  "sliderWidth",
  "sliderHeight",
  "backgroundColor",
  "backgroundColorDark",
  "cardColor",
  "accentColor",
  "cardRoundness",
  "buttonStyle",
  "inputStyle",
];

const LEGACY_ROUNDNESS: Record<string, number> = { none: 0, small: 6, medium: 10, large: 16, extra: 24 };
const LEGACY_BUTTON: Record<string, number> = { rounded: 10, pill: 999, square: 4 };

/**
 * Documents written by the v1 settings tab stored a flat object of enums
 * and colors. Read them into the token shape once; the next save rewrites
 * the document in the new shape. A document that already has a token group
 * is passed through untouched.
 */
export function migrateLegacyThemeSettings(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const hasGroups = THEME_TOKEN_GROUPS.some((group) => isRecord(raw[group.key]));
  const hasLegacy = LEGACY_KEYS.some((key) => key in raw);
  if (hasGroups || !hasLegacy) return raw;

  const light: Partial<ColorScheme> = {};
  const dark: Partial<ColorScheme> = {};
  if (isValidCssColor(raw.backgroundColor)) light.background = raw.backgroundColor;
  if (isValidCssColor(raw.cardColor)) light.surface = raw.cardColor;
  if (isValidCssColor(raw.accentColor)) light.primary = raw.accentColor;
  if (isValidCssColor(raw.backgroundColorDark)) dark.background = raw.backgroundColorDark;

  const shape: Record<string, unknown> = {};
  if (typeof raw.cardRoundness === "string" && raw.cardRoundness in LEGACY_ROUNDNESS) {
    shape.cardRadius = LEGACY_ROUNDNESS[raw.cardRoundness];
  }
  if (typeof raw.buttonStyle === "string" && raw.buttonStyle in LEGACY_BUTTON) {
    shape.buttonRadius = LEGACY_BUTTON[raw.buttonStyle];
  }
  if (typeof raw.inputStyle === "string" && raw.inputStyle in LEGACY_BUTTON) {
    shape.inputRadius = LEGACY_BUTTON[raw.inputStyle];
  }

  const layout: Record<string, unknown> = {};
  if (raw.containerWidth === "full") layout.pageWidth = "full";
  if (typeof raw.sliderWidth === "string") layout.sliderWidth = raw.sliderWidth;
  if (typeof raw.sliderHeight === "string") layout.sliderHeight = raw.sliderHeight;

  return {
    colors: {
      light,
      dark,
      darkMode: Object.keys(dark).length > 0 ? "custom" : "auto",
    },
    shape,
    layout,
  };
}

/**
 * The flat, legacy-shaped view sections still read (`ctx.themeSettings`):
 * the slider inheritance in `slider-grids.ts` and the store layout's
 * container attribute. Derived, never stored.
 */
export function legacySettingsView(tokens: ThemeTokens): Record<string, unknown> {
  return {
    containerWidth: tokens.layout.pageWidth === "full" ? "full" : "fixed",
    sliderWidth: tokens.layout.sliderWidth,
    sliderHeight: tokens.layout.sliderHeight,
  };
}
