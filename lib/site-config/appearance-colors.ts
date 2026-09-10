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

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function channelToHex(value: number): string {
  return clampChannel(value).toString(16).padStart(2, "0");
}

/**
 * Normalize a user-entered color (hex, rgb(), or rgba()) to a hex string the
 * rest of the app understands (`buildCustomColorVars`/`readableForegroundColor`
 * only parse hex). Returns null when the input can't be understood so callers
 * can keep the raw text in the field until it becomes valid. Alpha is dropped —
 * brand primary/secondary/accent are treated as opaque.
 */
export function normalizeColorToHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  // Plain boolean test (not the `value is string` guard) so the fall-through
  // below keeps `value` typed as string instead of narrowing to `never`.
  if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return value.toLowerCase();
  }

  const rgbMatch = value.match(
    /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*(?:\d*\.?\d+)\s*%?\s*)?\)$/i,
  );
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `#${channelToHex(Number(r))}${channelToHex(Number(g))}${channelToHex(Number(b))}`;
  }

  return null;
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
 * decide. rgb() input is accepted; the normalizer drops its alpha.
 */
export function colorTone(value: unknown): ColorTone | null {
  const hex = normalizeColorToHex(value);
  if (!hex) return null;
  const digits = expandHexDigits(hex.slice(1));
  if (digits.length === 8 && parseInt(digits.slice(6, 8), 16) < 128) {
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

/** WCAG relative luminance of a colour's six hex digits. */
function hexLuminance(digits: string): number {
  const channel = (i: number) => {
    const c = parseInt(digits.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * WCAG contrast ratio (1–21) of two colours, alpha ignored; 1 — no contrast
 * to speak of — when either cannot be read as a colour.
 */
export function contrastRatio(a: unknown, b: unknown): number {
  const hexA = normalizeColorToHex(a);
  const hexB = normalizeColorToHex(b);
  if (!hexA || !hexB) return 1;
  const [l1, l2] = [hexA, hexB]
    .map((hex) => hexLuminance(expandHexDigits(hex.slice(1))))
    .sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Pick a readable text color for content rendered on top of `hex`, using the
 * YIQ brightness of the color (alpha digits, if any, are ignored). Keeps
 * `bg-primary`/`bg-secondary` text legible whatever brand color an admin
 * configures — a light brand color gets dark text and vice versa.
 */
export function readableForegroundColor(hex: string): string {
  const digits = expandHexDigits(hex.trim().slice(1));
  return hexBrightness(digits) >= 128 ? "#1a1a1a" : "#ffffff";
}

/**
 * Map the configured appearance colors onto the global CSS variables the app
 * consumes. Blank or malformed values are skipped so a half-typed hex never
 * blanks a variable (the stylesheet default stays in effect instead).
 */
export function buildCustomColorVars(colors: {
  primary?: string;
  secondary?: string;
  accent?: string;
}): Record<string, string> {
  const vars: Record<string, string> = {};
  const primary = colors.primary?.trim();
  const secondary = colors.secondary?.trim();
  const accent = colors.accent?.trim();

  if (isValidCssColor(primary)) {
    // Primary drives the brand color plus the variables derived from it, mirroring
    // the sidebar/ring/chart usage the preset applier previously set. It also backs
    // the *-accent-foreground text so tinted hover/selected surfaces stay readable.
    for (const varName of [
      "--primary",
      "--ring",
      "--chart-1",
      "--sidebar-primary",
      "--sidebar-ring",
      "--accent-foreground",
      "--sidebar-accent-foreground",
    ]) {
      vars[varName] = primary;
    }
    const primaryForeground = readableForegroundColor(primary);
    vars["--primary-foreground"] = primaryForeground;
    vars["--sidebar-primary-foreground"] = primaryForeground;
  }

  if (isValidCssColor(secondary)) {
    vars["--secondary"] = secondary;
    vars["--secondary-foreground"] = readableForegroundColor(secondary);
  }

  // Accent backs shadcn's subtle hover/selected surface tokens (bg-accent, sidebar
  // hover, dropdown items…). We tint it ~12% so it reads as a surface, not a fill,
  // matching the app's existing accent look; `--accent-color` exposes the raw hex.
  if (isValidCssColor(accent)) {
    const tint = `color-mix(in oklab, ${accent} 12%, transparent)`;
    vars["--accent"] = tint;
    vars["--sidebar-accent"] = tint;
    vars["--accent-color"] = accent;
  }

  return vars;
}
