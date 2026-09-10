import { isValidCssColor, normalizeColorToHex } from "@/lib/site-config/appearance-colors";
import { isFontId } from "@/lib/storefront/fonts/catalog";
import {
  SLIDER_HEIGHTS,
  SLIDER_WIDTHS,
} from "@/lib/storefront/sections/slider-grids";
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
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/**
 * A role's value: a hex color, a brand reference, or "" — the role's own
 * fallback (documented per role in `COLOR_ROLE_META`): the theme's base
 * token for page colors, "same as X" for derived ones.
 */
export const BRAND_COLOR_REFS = [
  "brand.primary",
  "brand.secondary",
  "brand.accent",
] as const;
export type ColorValue = string;

export type ColorScheme = Record<ColorRole, ColorValue>;

const COLOR_ROLE_META: Record<
  ColorRole,
  { label: string; hint: string; fallback: string }
> = {
  background: { label: "Page background", hint: "Behind everything.", fallback: "Theme default" },
  surface: { label: "Surface", hint: "Cards, panels, drawers, menus.", fallback: "Same as page" },
  surfaceAlt: { label: "Surface alt", hint: "Banded sections, chips, skeletons.", fallback: "Theme default" },
  text: { label: "Text", hint: "Body copy and headings.", fallback: "Theme default" },
  textMuted: { label: "Text muted", hint: "Captions, meta, placeholders.", fallback: "Theme default" },
  border: { label: "Border", hint: "Dividers and field borders.", fallback: "Theme default" },
  primary: { label: "Primary", hint: "Primary buttons, focus rings.", fallback: "Brand primary" },
  onPrimary: { label: "On primary", hint: "Text on primary buttons.", fallback: "Auto (readable)" },
  secondary: { label: "Secondary", hint: "Secondary buttons and chips.", fallback: "Same as surface alt" },
  onSecondary: { label: "On secondary", hint: "Text on secondary buttons.", fallback: "Same as text" },
  accent: { label: "Accent", hint: "Highlights and hover fills.", fallback: "Brand accent" },
  sale: { label: "Sale", hint: "Discount badges, deal timers, strike prices.", fallback: "Theme default (red)" },
  rating: { label: "Rating", hint: "Review stars.", fallback: "Theme default (amber)" },
  link: { label: "Link", hint: "Inline text links.", fallback: "Same as primary" },
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
  colors: { light: { ...EMPTY_SCHEME }, dark: { ...EMPTY_SCHEME }, darkMode: "auto" },
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
  layout: { pageWidth: "1280", pagePadding: 16, sliderWidth: "fixed", sliderHeight: "half" },
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
}

/** Whether a field applies given its group's current values. */
export function isFieldVisible(
  field: TokenField,
  groupValues: Record<string, unknown>,
): boolean {
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
    description:
      "One scheme per mode. Brand colors live in Branding; a role can reference them or hold its own color.",
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
    description: "Page width, and the global defaults hero and banner sections inherit.",
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
      { key: "sliderWidth", kind: "picture", label: "Slider width style", options: SLIDER_WIDTHS.map((width) => ({ key: width.key, label: width.label })) },
      { key: "sliderHeight", kind: "picture", label: "Slider height", options: SLIDER_HEIGHTS.map((height) => ({ key: height.key, label: height.label })) },
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

export function getTokenGroup(key: ThemeGroupKey): TokenGroup {
  const group = THEME_TOKEN_GROUPS.find((candidate) => candidate.key === key);
  if (!group) throw new Error(`Unknown theme token group: ${key}`);
  return group;
}

/* ------------------------------------------------------------------ */
/* Normalization                                                        */
/* ------------------------------------------------------------------ */

function normalizeColorValue(value: unknown): ColorValue {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((BRAND_COLOR_REFS as readonly string[]).includes(trimmed)) return trimmed;
  return normalizeColorToHex(trimmed) ?? "";
}

function normalizeScheme(raw: unknown, fallback: ColorScheme): ColorScheme {
  const source = isRecord(raw) ? raw : {};
  const scheme = { ...fallback };
  for (const role of COLOR_ROLES) {
    if (role in source) scheme[role] = normalizeColorValue(source[role]);
  }
  return scheme;
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
      return normalizeColorValue(value);
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
 * Merge overrides over defaults, field by field through the schema. Unknown
 * keys are dropped, malformed values fall back, numbers clamp — a tampered
 * or outdated document can only ever produce tokens the schema describes.
 */
export function normalizeThemeTokens(
  defaults: ThemeTokens,
  overrides: unknown,
): ThemeTokens {
  const source = isRecord(overrides) ? migrateLegacyThemeSettings(overrides) : {};
  const result = structuredClone(defaults);

  for (const group of THEME_TOKEN_GROUPS) {
    const raw = isRecord(source[group.key]) ? (source[group.key] as Record<string, unknown>) : {};
    if (group.key === "colors") {
      result.colors.light = normalizeScheme(raw.light, defaults.colors.light);
      result.colors.dark = normalizeScheme(raw.dark, defaults.colors.dark);
      result.colors.darkMode = (DARK_MODES as readonly string[]).includes(raw.darkMode as string)
        ? (raw.darkMode as DarkMode)
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
