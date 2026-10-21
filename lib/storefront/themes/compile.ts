import { composite, mix, opaqueHex, parseColor } from "@/lib/theme-colors/color";
import { actionColors, interactionColors, readableTone, readableToneOn, visibleTone } from "@/lib/theme-colors/derive";
import {
  isValidCssColor,
  readableForegroundColor,
} from "@/lib/site-config/appearance-colors";
import { fontFamilyStack } from "@/lib/storefront/fonts/catalog";
import {
  BRAND_COLOR_REFS,
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
  skeleton?: string;
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

export const ROLE_VAR = Object.fromEntries(COLOR_ROLES.map(role => [role,role.replace(/[A-Z]/g,c => "-"+c.toLowerCase())])) as Record<ColorRole,string>;

/** Every variable the compiler can emit (same purpose as the attributes). */
export const THEME_VARS = [
  ...COLOR_ROLES.map((role) => `--store-l-${ROLE_VAR[role]}`),
  ...COLOR_ROLES.map((role) => `--store-d-${ROLE_VAR[role]}`),
  ...["l","d"].flatMap(mode => ["primary-hover","primary-pressed"].map(role => `--store-${mode}-${role}`)),
  ...["l","d"].flatMap(mode => ["text","text-muted","border"].map(role => `--store-${mode}-on-${role}`)),
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
const LIGHT_BASE: Partial<Record<ColorRole, string>> = {
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
  skeleton: "", // → a step from the page toward its text
};

/* The dark palette: the page roles dark mode paints on its own. */
const DARK_BASE: Partial<Record<ColorRole, string>> = {
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
  accent: "",
  sale: "#ef4444",
  rating: "#fbbf24",
  link: "",
  skeleton: "",
};

/**
 * The roles dark mode takes from the LIGHT scheme: the brand-driven ones, so
 * a custom primary or sale colour survives the switch. Page colours, text
 * and every derived state come from the dark base instead. A dark colour
 * the merchant set (darkMode "custom") replaces just its own role.
 */
const LIGHT_FOLLOWED_ROLES: readonly ColorRole[] = ["primary", "secondary", "accent", "sale", "rating", "link"];

/**
 * What a theme that OWNS its key colours (colour schema 4) falls back to for
 * a primary or accent left on its default: the engine's own, never the store
 * brand — which now mirrors the LIVE theme, so falling back to it would leak
 * one theme's colours into another.
 */
const OWN_THEME_FALLBACK: BrandColors = { primary: "#2065d1", secondary: "", accent: "#f59e0b", skeleton: "" };

const SHADOWS: Record<string, string> = {
  none: "none",
  soft: "0 1px 2px rgb(0 0 0 / 0.05), 0 4px 12px rgb(0 0 0 / 0.06)",
  medium: "0 4px 16px rgb(0 0 0 / 0.12), 0 2px 4px rgb(0 0 0 / 0.06)",
};

function resolveRef(value: string, brand: BrandColors): string {
  switch (value) {
    case "brand.primary":
      return brand.primary;
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
 *
 * `explicit` says which roles hold a colour the merchant chose FOR THIS
 * MODE: those paint as chosen (the editor flags a weak one). Everything
 * else is the engine's to make readable — a muted text or a star toned to
 * its surfaces, and in dark mode a brand fill carried over from light (a
 * navy button, a black one) lifted until it shows on the dark page.
 */
function resolveScheme(
  scheme: ColorScheme,
  base: Partial<Record<ColorRole, string>>,
  brand: BrandColors,
  dark: boolean,
  explicit: (role: ColorRole) => boolean,
): Record<ColorRole, string> {
  const pick = (role: ColorRole) => resolveRef(scheme[role], brand) || base[role] || "";
  const background = composite(pick("background"), dark ? "#1a1a1a" : "#ffffff");
  const surface = composite(pick("surface") || background, background);
  const surfaceAlt = composite(pick("surfaceAlt"), surface);
  // A dark fill carried over from light, or one that follows the brand (the
  // Dark tab's "Brand" source), is lifted until it shows on the dark page; a
  // hex set for dark is painted as set.
  const fill = (role: ColorRole, value: string) =>
    dark && (!explicit(role) || (BRAND_COLOR_REFS as readonly string[]).includes(scheme[role]))
      ? visibleTone(value, [background, surface], 3)
      : value;
  const readable = (value: string, minimum = 4.5) =>
    readableToneOn(value, [background, surface], [surfaceAlt], minimum);
  const text = pick("text");
  const primary = fill("primary", opaqueHex(pick("primary") || brand.primary) ?? "#2065d1");
  const accent = fill("accent", opaqueHex(pick("accent") || brand.accent) ?? "#f59e0b");
  // Add to cart. Unset, it is the text colour — the dark button (light in
  // dark mode) the storefront has always drawn there.
  const ownSecondary = opaqueHex(pick("secondary"));
  const secondary = ownSecondary ? fill("secondary", ownSecondary) : opaqueHex(text) ?? (dark ? "#fafafa" : "#212b36");
  const sale = fill("sale", opaqueHex(pick("sale")) ?? "#dc2626");
  const derived = interactionColors(surface,text,primary,accent,sale,dark);
  const result: Record<ColorRole,string> = {
    background,surface,surfaceAlt,text,primary,secondary,accent,sale,
    textMuted: explicit("textMuted") ? pick("textMuted") : readable(pick("textMuted")),
    border: pick("border"),
    onPrimary: pick("onPrimary") || readableForegroundColor(primary),
    onSecondary: pick("onSecondary") || readableForegroundColor(secondary),
    rating: explicit("rating") ? pick("rating") : readable(pick("rating"),3),
    link: explicit("link") ? pick("link") : readable(pick("link") || primary),
    ...derived,
    focusRing: readable(primary,3),
    fieldBorder: readable(pick("border"),3),
    saleText: readable(sale),
    // Unset, a step from the page toward its text: visible on any page
    // colour (a fixed #f0f0f0 vanished on an oatmeal or grey page). The old
    // brand-wide skeleton colour had no screen left to change it, so it no
    // longer paints.
    skeleton:
      opaqueHex(pick("skeleton")) ??
      mix(background, opaqueHex(text) ?? (dark ? "#fafafa" : "#212b36"), dark ? 0.12 : 0.08),
  };
  for (const role of ["onAccent","accentSurface","onAccentSurface","hoverSurface","onHover","selectedSurface","onSelected","focusRing","fieldBorder","onSale","saleText","saleSurface","onSaleSurface"] as const) {
    if (scheme[role]) result[role] = pick(role);
  }
  for (const [fill,ink] of [["hoverSurface","onHover"],["selectedSurface","onSelected"],["accentSurface","onAccentSurface"],["saleSurface","onSaleSurface"]] as const) {
    if (!scheme[ink]) result[ink] = ink === "onHover" || ink === "onSelected" ? readableTone(text,[result[fill]]) : readableForegroundColor(result[fill]);
  }
  return result;
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

/** Write opaque v2 colors without changing an untouched legacy surface's paint. */
export function canonicalizeThemeColors(tokens:ThemeTokens,previous:ThemeTokens,brand:BrandColors):ThemeTokens {
  const next=structuredClone(tokens);
  const resolved=resolveThemeSchemes({...tokens,colors:{...tokens.colors,darkMode:"custom"}},brand);
  for (const mode of ["light","dark"] as const) for (const role of COLOR_ROLES) {
    const raw=tokens.colors[mode][role];
    const parsed=parseColor(raw);
    if (!parsed) continue;
    const legacySurface=["background","surface","surfaceAlt"].includes(role) && parsed.a<1 && raw === previous.colors[mode][role];
    next.colors[mode][role]=legacySurface ? resolved[mode][role] : opaqueHex(raw)!;
  }
  return next;
}

export function compileTheme(
  tokens: ThemeTokens,
  brand: BrandColors,
): CompiledTheme {
  const vars: Record<string, string> = {};
  const attributes: Record<string, string> = {};
  const fontIds: string[] = [];
  const fallback = tokens.colors.schemaVersion === 4 ? OWN_THEME_FALLBACK : brand;

  /* Colors — light as set; dark follows light, with the merchant's own dark
     colours (darkMode "custom") replacing just their roles. */
  const light = resolveScheme(
    tokens.colors.light,
    LIGHT_BASE,
    fallback,
    false,
    (role) => Boolean(tokens.colors.light[role]),
  );
  const darkOverrides = new Set(
    tokens.colors.darkMode === "custom"
      ? COLOR_ROLES.filter((role) => tokens.colors.dark[role])
      : [],
  );
  const darkScheme = Object.fromEntries(
    COLOR_ROLES.map((role) => [
      role,
      darkOverrides.has(role)
        ? tokens.colors.dark[role]
        : LIGHT_FOLLOWED_ROLES.includes(role)
          ? tokens.colors.light[role]
          : "",
    ]),
  ) as ColorScheme;
  const dark = resolveScheme(darkScheme, DARK_BASE, fallback, true, (role) =>
    darkOverrides.has(role),
  );
  for (const [mode,scheme] of [["l",light],["d",dark]] as const) {
    for (const [name,role] of [["text","text"],["text-muted","textMuted"],["border","border"]] as const) vars[`--store-${mode}-on-${name}`] = readableForegroundColor(composite(scheme[role],scheme.surface));
    const action = actionColors(scheme.primary,scheme.onPrimary);
    vars[`--store-${mode}-primary-hover`] = action.hover;
    vars[`--store-${mode}-primary-pressed`] = action.pressed;
  }
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
