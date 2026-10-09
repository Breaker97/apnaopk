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

export function color(value: unknown): string | undefined {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : undefined;
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
