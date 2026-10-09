import {
  isValidCssColor,
  readableForegroundColor,
} from "@/lib/site-config/appearance-colors";
import { fontFamilyStack } from "@/lib/storefront/fonts/catalog";
import {
  COLOR_ROLES,
  type ColorRole,
  type ColorScheme,
  type ThemeTokens,
} from "./tokens";

/**
 * Tokens → CSS. The ONE place a theme setting becomes a custom property or
 * an attribute on the store surface. The server layout calls it for the
 * first paint, the body mirror copies its output for portaled overlays, and
 * the Themes editor's preview bridge runs the same function in the browser
 * — so the preview can never disagree with what the storefront will paint.
 *
 * The compiler always emits every color role for both modes: the consumer
 * rules in globals.css read `--store-l-*` / `--store-d-*` without fallbacks,
 * which keeps the mapping in exactly one place (here) instead of two.
 */

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
}

interface CompiledTheme {
  vars: Record<string, string>;
  attributes: Record<string, string>;
  /** Catalog ids whose faces the page will paint with (for preloading). */
  fontIds: string[];
}

/** Every attribute the compiler can put on the surface — the preview clears
 * these before applying a new payload, so an undone choice goes away. */
export const THEME_ATTRIBUTES = [
  "data-container",
  "data-font-body",
  "data-font-heading",
  "data-btn-font",
  "data-hover",
] as const;

const ROLE_VAR: Record<ColorRole, string> = {
  background: "background",
  surface: "surface",
  surfaceAlt: "surface-alt",
  text: "text",
  textMuted: "text-muted",
  border: "border",
  primary: "primary",
  onPrimary: "on-primary",
  secondary: "secondary",
  onSecondary: "on-secondary",
  accent: "accent",
  sale: "sale",
  rating: "rating",
  link: "link",
};

/** Every variable the compiler can emit (same purpose as the attributes). */
export const THEME_VARS = [
  ...COLOR_ROLES.map((role) => `--store-l-${ROLE_VAR[role]}`),
  ...COLOR_ROLES.map((role) => `--store-d-${ROLE_VAR[role]}`),
  "--store-font-body",
  "--store-font-heading",
  "--store-heading-weight",
  "--store-heading-tracking",
  "--store-heading-transform",
  "--store-btn-font",
  "--store-btn-weight",
  "--store-btn-transform",
  "--store-btn-tracking",
  "--store-page-width",
  "--store-page-padding",
  "--radius",
  "--store-radius-card",
  "--store-radius-button",
  "--store-radius-input",
  "--store-radius-badge",
  "--store-border-card",
  "--store-border-input",
  "--store-shadow-card",
  "--store-shadow-overlay",
  "--store-btn-height",
] as const;

/* The engine's own palette — what "" resolves to for page colors. These are
 * the values globals.css painted before themes had color tokens, so an
 * untouched store looks exactly as it did. */
const LIGHT_BASE: Record<ColorRole, string> = {
  background: "#ffffff",
  surface: "", // → background
  surfaceAlt: "#f4f6f8",
  text: "#212b36",
  textMuted: "#637381",
  border: "#ebebeb",
  primary: "", // → brand.primary
  onPrimary: "", // → readable on primary
  secondary: "", // → surfaceAlt
  onSecondary: "", // → text
  accent: "", // → brand.accent
  sale: "#dc2626",
  rating: "#f59e0b",
  link: "", // → primary
};

/* The dark palette derived from the base when dark is "auto". */
const DARK_BASE: Record<ColorRole, string> = {
  background: "#1a1a1a",
  surface: "#262626",
  surfaceAlt: "#333333",
  text: "#fafafa",
  textMuted: "#a3a3a3",
  border: "#2f2f2f",
  primary: "",
  onPrimary: "",
  secondary: "",
  onSecondary: "",
  accent: "#333333",
  sale: "#ef4444",
  rating: "#fbbf24",
  link: "",
};

const SHADOWS: Record<string, string> = {
  none: "none",
  soft: "0 1px 2px rgb(0 0 0 / 0.05), 0 4px 12px rgb(0 0 0 / 0.06)",
  medium: "0 4px 16px rgb(0 0 0 / 0.12), 0 2px 4px rgb(0 0 0 / 0.06)",
};

function resolveRef(value: string, brand: BrandColors): string {
  switch (value) {
    case "brand.primary":
      return brand.primary;
    case "brand.secondary":
      return brand.secondary;
    case "brand.accent":
      return brand.accent;
    default:
      return isValidCssColor(value) ? value : "";
  }
}

/**
 * Resolve one scheme to a concrete color per role. "" walks the role's
 * documented fallback (COLOR_ROLE_META): base palette, brand color, or
 * another role.
 */
function resolveScheme(
  scheme: ColorScheme,
  base: Record<ColorRole, string>,
  brand: BrandColors,
): Record<ColorRole, string> {
  const pick = (role: ColorRole) =>
    resolveRef(scheme[role], brand) || base[role];

  const background = pick("background");
  const surface = pick("surface") || background;
  const surfaceAlt = pick("surfaceAlt");
  const text = pick("text");
  const primary = pick("primary") || brand.primary;
  const accent = pick("accent") || brand.accent;
  const secondary = pick("secondary") || surfaceAlt;
  return {
    background,
    surface,
    surfaceAlt,
    text,
    textMuted: pick("textMuted"),
    border: pick("border"),
    primary,
    onPrimary: pick("onPrimary") || readableForegroundColor(primary),
    secondary,
    onSecondary: pick("onSecondary") || readableForegroundColor(secondary),
    accent,
    sale: pick("sale"),
    rating: pick("rating"),
    link: pick("link") || primary,
  };
}

/**
 * Both schemes fully resolved — what the editor shows in swatches and reads
 * contrast against, computed exactly as the compiler will paint them.
 */
export function resolveThemeSchemes(
  tokens: ThemeTokens,
  brand: BrandColors,
): { light: Record<ColorRole, string>; dark: Record<ColorRole, string> } {
  const { vars } = compileTheme(tokens, brand);
  const read = (prefix: "l" | "d") =>
    Object.fromEntries(
      COLOR_ROLES.map((role) => [role, vars[`--store-${prefix}-${ROLE_VAR[role]}`]]),
    ) as Record<ColorRole, string>;
  return { light: read("l"), dark: read("d") };
}

export function compileTheme(
  tokens: ThemeTokens,
  brand: BrandColors,
): CompiledTheme {
  const vars: Record<string, string> = {};
  const attributes: Record<string, string> = {};
  const fontIds: string[] = [];

  /* Colors — light, and dark either derived or explicit. */
  const light = resolveScheme(tokens.colors.light, LIGHT_BASE, brand);
  const darkScheme =
    tokens.colors.darkMode === "custom"
      ? tokens.colors.dark
      : // Auto: the dark base, but the brand-driven roles follow light so a
        // custom primary survives the mode switch.
        ({
          ...Object.fromEntries(COLOR_ROLES.map((role) => [role, ""])),
          primary: tokens.colors.light.primary,
          accent: tokens.colors.light.accent === "" ? "" : tokens.colors.light.accent,
          sale: tokens.colors.light.sale,
          rating: tokens.colors.light.rating,
          link: tokens.colors.light.link,
        } as ColorScheme);
  const dark = resolveScheme(darkScheme, DARK_BASE, brand);
  for (const role of COLOR_ROLES) {
    vars[`--store-l-${ROLE_VAR[role]}`] = light[role];
    vars[`--store-d-${ROLE_VAR[role]}`] = dark[role];
  }

  /* Typography */
  const bodyStack = fontFamilyStack(tokens.type.bodyFont);
  if (bodyStack) {
    vars["--store-font-body"] = bodyStack;
    attributes["data-font-body"] = "";
    fontIds.push(tokens.type.bodyFont);
  }
  const headingStack = fontFamilyStack(tokens.type.headingFont);
  if (headingStack) {
    vars["--store-font-heading"] = headingStack;
    attributes["data-font-heading"] = "";
    if (!fontIds.includes(tokens.type.headingFont)) fontIds.push(tokens.type.headingFont);
  }
  vars["--store-heading-weight"] = tokens.type.headingWeight;
  vars["--store-heading-tracking"] = `${tokens.type.headingTracking}em`;
  vars["--store-heading-transform"] = tokens.type.headingTransform;
  const buttonStack =
    tokens.type.buttonFont === "heading" ? headingStack : bodyStack;
  if (buttonStack) {
    vars["--store-btn-font"] = buttonStack;
    attributes["data-btn-font"] = "";
  }
  vars["--store-btn-weight"] = tokens.type.buttonWeight;
  vars["--store-btn-transform"] = tokens.type.buttonTransform;
  vars["--store-btn-tracking"] = `${tokens.type.buttonTracking}em`;

  /* Layout */
  if (tokens.layout.pageWidth === "full") {
    attributes["data-container"] = "full";
    vars["--store-page-padding"] = `${tokens.layout.pagePadding}px`;
  } else {
    attributes["data-container"] = "fixed";
    vars["--store-page-width"] = `${tokens.layout.pageWidth}px`;
  }

  /* Shapes */
  vars["--radius"] = `${tokens.shape.cardRadius}px`;
  vars["--store-radius-card"] = `${tokens.shape.cardRadius}px`;
  if (tokens.shape.buttonRadius !== "") {
    vars["--store-radius-button"] = `${tokens.shape.buttonRadius}px`;
  }
  if (tokens.shape.inputRadius !== "") {
    vars["--store-radius-input"] = `${tokens.shape.inputRadius}px`;
  }
  vars["--store-radius-badge"] = `${tokens.shape.badgeRadius}px`;
  vars["--store-border-card"] = `${tokens.shape.cardBorder}px`;
  vars["--store-border-input"] = `${tokens.shape.inputBorder}px`;
  vars["--store-shadow-card"] = SHADOWS[tokens.shape.cardShadow] ?? "none";
  vars["--store-shadow-overlay"] = SHADOWS[tokens.shape.overlayShadow] ?? "none";

  /* Buttons */
  vars["--store-btn-height"] = `${tokens.buttons.height}px`;
  if (tokens.buttons.hover !== "none") {
    attributes["data-hover"] = tokens.buttons.hover;
  }

  return { vars, attributes, fontIds };
}
