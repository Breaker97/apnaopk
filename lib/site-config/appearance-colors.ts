import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR, DEFAULT_ACCENT_COLOR } from "@/config/branding.config";
import { contrastRatio as wcagContrast, readableForegroundColor as wcagForeground } from "@/lib/theme-colors/contrast";
import { opaqueHex, parseColor } from "@/lib/theme-colors/color";
import { actionColors, interactionColors, readableTone, visibleTone } from "@/lib/theme-colors/derive";
/**
 * Custom brand-color helpers shared by the server layout (which inlines the
 * CSS variables on <html> so the first paint already uses the configured
 * colors — no flash of the stylesheet defaults) and the client settings
 * applier (which re-applies them when an admin edits appearance settings).
 */

/** True for well-formed CSS hex colors (#RGB, #RGBA, #RRGGBB, #RRGGBBAA). */
export function isValidCssColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim())
  );
}

/**
 * Normalize a user-entered color (hex, rgb(), or rgba()) to a hex string the
 * rest of the app understands (`buildCustomColorVars`/`readableForegroundColor`
 * only parse hex). Returns null when the input can't be understood so callers
 * can keep the raw text in the field until it becomes valid. Alpha is dropped —
 * brand primary/secondary/accent are treated as opaque.
 */
export function normalizeColorToHex(input: unknown): string | null {
  return opaqueHex(input);
}

/**
 * Coerce any stored color into the 7-char `#rrggbb` a native `<input type=color>`
 * requires (it rejects 3/4/8-digit hex, rgb(), or blanks). Falls back to the
 * supplied default so the swatch always has something valid to render.
 */
export function toColorInputValue(value: unknown, fallback = "#000000"): string {
  const hex = normalizeColorToHex(value);
  if (!hex) return fallback;
  let digits = hex.slice(1);
  if (digits.length === 3 || digits.length === 4) {
    digits = digits
      .slice(0, 3)
      .split("")
      .map((d) => d + d)
      .join("");
  }
  return `#${digits.slice(0, 6)}`;
}

/** Case-insensitive equality for two colors, comparing their normalized hex. */
export function colorsEqual(a: unknown, b: unknown): boolean {
  const hexA = normalizeColorToHex(a);
  const hexB = normalizeColorToHex(b);
  if (!hexA || !hexB) return false;
  return toColorInputValue(hexA) === toColorInputValue(hexB);
}

/** Hex digits with shorthand expanded: `abc` → `aabbcc`, `abcd` → `aabbccdd`. */
function expandHexDigits(digits: string): string {
  return digits.length <= 4
    ? digits
        .split("")
        .map((d) => d + d)
        .join("")
    : digits;
}

/** YIQ brightness (0–255) of a hex colour's rgb digits. */
function hexBrightness(digits: string): number {
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export type ColorTone = "light" | "dark";

/**
 * Whether a colour reads as a light or a dark surface — or neither: a
 * malformed value has no tone, and a translucent one (alpha under half)
 * shows what sits behind it, so the surface's tone is not the colour's to
 * decide. Parsing keeps alpha for this classification.
 */
export function colorTone(value: unknown): ColorTone | null {
  const parsed = parseColor(value);
  const hex = normalizeColorToHex(value);
  if (!hex || !parsed) return null;
  const digits = expandHexDigits(hex.slice(1));
  if (parsed.a < 0.5) {
    return null;
  }
  return hexBrightness(digits) >= 128 ? "light" : "dark";
}

/** Chroma (0–255): how far a colour sits from grey. Null when malformed. */
export function colorChroma(value: unknown): number | null {
  const hex = normalizeColorToHex(value);
  if (!hex) return null;
  const digits = expandHexDigits(hex.slice(1));
  const channels = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  return Math.max(...channels) - Math.min(...channels);
}

export const contrastRatio = wcagContrast;
export const readableForegroundColor = wcagForeground;

/**
 * The brand as the dashboards and every non-storefront page paint it (the
 * storefront compiles its own scheme from the theme). Primary drives
 * actions, focus, links and selection; the accent stays a promotional
 * colour. Secondary deliberately does NOT reach shadcn's `secondary`: that
 * token is the dashboards' neutral chip and button, and a brand navy or
 * violet painted every Draft/Pending badge and secondary button solid.
 * Each mode gets its own values — a near-black primary is lifted in dark
 * mode so a button never disappears into the page. CSS selects the mode.
 */
export function buildCustomColorVars(colors: {
  primary?: string;
  secondary?: string;
  accent?: string;
}): Record<string, string> {
  const vars: Record<string, string> = {};
  const primary = opaqueHex(colors.primary) ?? opaqueHex(DEFAULT_PRIMARY_COLOR)!;
  const secondary = opaqueHex(colors.secondary) ?? opaqueHex(DEFAULT_SECONDARY_COLOR)!;
  const accent = opaqueHex(colors.accent) ?? opaqueHex(DEFAULT_ACCENT_COLOR)!;
  vars["--brand-primary"] = primary;
  vars["--brand-secondary"] = secondary;
  vars["--brand-accent"] = accent;
  vars["--accent-color"] = accent;
  for (const [mode, surface, text] of [["l", "#ffffff", "#212b36"], ["d", "#262626", "#fafafa"]]) {
    const surfaces = [surface,mode === "l" ? "#f4f6f8" : "#1a1a1a"];
    const modePrimary = mode === "d" ? visibleTone(primary,surfaces,3) : primary;
    const modeAccent = mode === "d" ? visibleTone(accent,surfaces,3) : accent;
    const derived = interactionColors(surface,text,modePrimary,modeAccent,"#dc2626",mode === "d");
    const onPrimary = wcagForeground(modePrimary);
    const action=actionColors(modePrimary,onPrimary);
    vars[`--brand-${mode}-primary-hover`] = action.hover;
    vars[`--brand-${mode}-primary-pressed`] = action.pressed;
    const roles = {primary:modePrimary,onPrimary,accent:modeAccent,...derived,focusRing:readableTone(modePrimary,surfaces,3),link:readableTone(modePrimary,surfaces)};
    for (const [role,value] of Object.entries(roles)) vars[`--brand-${mode}-${role.replace(/[A-Z]/g,c=>"-"+c.toLowerCase())}`] = value;
  }
  return vars;
}
