import { isThemeColorRef } from "@/lib/theme-colors/theme-refs";

/**
 * Value readers shared by the slider normalizer and the background contract
 * (lib/sliders/background.ts).
 */

/**
 * Three, six or eight hex digits: the eight-digit form carries an alpha
 * channel, which is how a background says "60% white" — one value, painted
 * by the browser, no separate opacity to keep in step with the colour.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function str(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * A hex colour, or a theme colour reference (`var(--theme-primary)`, see
 * lib/theme-colors/theme-refs.ts) — the one non-hex value a background may
 * hold, so a header button or a banner can follow Theme settings → Colors.
 */
export function color(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (HEX_COLOR.test(value)) return value;
  return isThemeColorRef(value) ? value.trim() : undefined;
}

/** A parseable date string as stored, or nothing. */
export function isoDate(value: unknown): string | undefined {
  return typeof value === "string" && value && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

export function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

export function hexChannels(hex: string): { r: number; g: number; b: number; a: number } | null {
  const digits = hex.trim().replace(/^#/, "");
  const full =
    digits.length === 3 || digits.length === 4
      ? digits.split("").map((d) => d + d).join("")
      : digits;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return null;
  const n = (at: number) => parseInt(full.slice(at, at + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
}
