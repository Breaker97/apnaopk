import { opaqueHex } from "./color";
import { readableForegroundColor } from "./contrast";

/**
 * Theme colour REFERENCES: a colour field that says "the theme's primary"
 * instead of a hex, so a header button, a footer or the chat widget changes
 * with Theme settings → Colors rather than keeping the blue it was drawn in.
 *
 * Stored verbatim as the CSS it paints (`var(--theme-primary)`). The
 * `--theme-*` aliases are set beside the shadcn variables on the store
 * surface (globals.css) and are never reassigned anywhere else — so a header
 * row that sets `--background` or `--foreground` for its panels can take a
 * reference without creating a variable cycle, which the shadcn names would.
 * Each reference carries the ink that reads on it (`--theme-on-*`), per mode.
 */
export const THEME_COLOR_REFS = [
  { key: "primary", label: "Primary", css: "var(--theme-primary)", ink: "var(--theme-on-primary)" },
  { key: "secondary", label: "Secondary", css: "var(--theme-secondary)", ink: "var(--theme-on-secondary)" },
  { key: "accent", label: "Accent", css: "var(--theme-accent)", ink: "var(--theme-on-accent)" },
  { key: "background", label: "Background", css: "var(--theme-background)", ink: "var(--theme-on-background)" },
  { key: "surface", label: "Cards", css: "var(--theme-surface)", ink: "var(--theme-on-surface)" },
  { key: "surfaceAlt", label: "Bands & chips", css: "var(--theme-surface-alt)", ink: "var(--theme-on-surface-alt)" },
  { key: "text", label: "Text", css: "var(--theme-text)", ink: "var(--theme-on-text)" },
  { key: "textMuted", label: "Secondary text", css: "var(--theme-text-muted)", ink: "var(--theme-on-text-muted)" },
  { key: "border", label: "Dividers", css: "var(--theme-border)", ink: "var(--theme-on-border)" },
] as const;

export type ThemeColorRef = (typeof THEME_COLOR_REFS)[number];

/**
 * The ink for text on a colour a merchant picked: a reference's own pair,
 * else white or near-black by contrast. For widgets that used to write
 * white on whatever colour they were given.
 */
export function inkOn(color: string): string {
  const ink = themeColorInk(color);
  if (ink) return ink;
  const hex = opaqueHex(color);
  return hex ? readableForegroundColor(hex) : "#ffffff";
}

/** A stored widget colour: a hex or a reference, else the fallback. */
export function widgetColor(value: unknown, fallback: string): string {
  if (isThemeColorRef(value)) return value.trim();
  return opaqueHex(value) ?? fallback;
}
export type ThemeColorRefKey = ThemeColorRef["key"];

const BY_CSS = new Map<string, ThemeColorRef>(THEME_COLOR_REFS.map((ref) => [ref.css, ref]));

/** The reference a stored value names, or undefined for a plain colour. */
export function themeColorRef(value: unknown): ThemeColorRef | undefined {
  return typeof value === "string" ? BY_CSS.get(value.trim()) : undefined;
}

export function isThemeColorRef(value: unknown): value is ThemeColorRef["css"] {
  return themeColorRef(value) !== undefined;
}

/** The ink that reads on a referenced colour; undefined for anything else. */
export function themeColorInk(value: unknown): string | undefined {
  return themeColorRef(value)?.ink;
}

/** The reference for a key, as stored. */
export function themeColorCss(key: ThemeColorRefKey): string {
  return THEME_COLOR_REFS.find((ref) => ref.key === key)!.css;
}

/**
 * The `--theme-*` values for one mode of a compiled theme (the
 * `--store-l-*` / `--store-d-*` variables `compileTheme` emits) — what an
 * admin preview sets so a reference paints the store's colour — and each
 * reference's swatch for display.
 */
export function themeRefChoices(
  compiledVars: Record<string, string>,
  mode: "l" | "d" = "l",
): { swatches: Record<ThemeColorRefKey, string>; vars: Record<string, string> } {
  const v = (name: string) => compiledVars[`--store-${mode}-${name}`] ?? "";
  const pairs: Record<ThemeColorRefKey, [string, string]> = {
    primary: [v("primary"), v("on-primary")],
    secondary: [v("secondary"), v("on-secondary")],
    accent: [v("accent"), v("on-accent")],
    background: [v("background"), v("text")],
    surface: [v("surface"), v("text")],
    surfaceAlt: [v("surface-alt"), v("text")],
    text: [v("text"), v("on-text")],
    textMuted: [v("text-muted"), v("on-text-muted")],
    border: [v("border"), v("on-border")],
  };
  const swatches = {} as Record<ThemeColorRefKey, string>;
  const vars: Record<string, string> = {};
  for (const ref of THEME_COLOR_REFS) {
    const [paint, ink] = pairs[ref.key];
    swatches[ref.key] = paint;
    vars[ref.css.slice(4, -1)] = paint;
    vars[ref.ink.slice(4, -1)] = ink;
  }
  return { swatches, vars };
}
