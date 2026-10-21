import { fromHsl, parseColor, toHex, toHsl, type Rgba } from "./color";

/** The spellings a colour field can show and accept. Stored values stay hex. */
export type ColorFormat = "hex" | "rgb" | "hsl" | "oklch";

export const COLOR_FORMATS: readonly ColorFormat[] = ["hex", "rgb", "hsl", "oklch"];

/** The format after `format`, wrapping round: the order a format button cycles. */
export function nextColorFormat(format: ColorFormat): ColorFormat {
  return COLOR_FORMATS[(COLOR_FORMATS.indexOf(format) + 1) % COLOR_FORMATS.length];
}

const channel = (value: number) => Math.max(0, Math.min(1, value));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

type Oklch = { l: number; c: number; h: number };

/** sRGB to OKLCH (Björn Ottosson's OKLab): lightness 0–1, chroma, hue in degrees. */
function rgbToOklch({ r, g, b }: Rgba): Oklch {
  const lr = toLinear(r / 255);
  const lg = toLinear(g / 255);
  const lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(a, bb);
  // Hue means nothing for a grey; report 0 rather than noise.
  const h = c < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** OKLCH to sRGB; a colour outside the sRGB gamut is clamped to its edge. */
function oklchToRgb({ l: L, c, h }: Oklch): Pick<Rgba, "r" | "g" | "b"> {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return {
    r: channel(fromLinear(channel(lr))) * 255,
    g: channel(fromLinear(channel(lg))) * 255,
    b: channel(fromLinear(channel(lb))) * 255,
  };
}

const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;
const HSL_TEXT = new RegExp(
  String.raw`^hsla?\(\s*(${NUMBER})(?:deg)?\s*[,\s]\s*(${NUMBER})%\s*[,\s]\s*(${NUMBER})%\s*(?:[,/]\s*(${NUMBER})(%)?\s*)?\)$`,
  "i",
);
const OKLCH_TEXT = new RegExp(
  String.raw`^oklch\(\s*(${NUMBER})(%)?\s*[,\s]\s*(${NUMBER})\s*[,\s]\s*(${NUMBER})(?:deg)?\s*(?:[,/]\s*(${NUMBER})(%)?\s*)?\)$`,
  "i",
);

const unitAlpha = (value: string | undefined, percent: string | undefined): number => {
  if (value === undefined) return 1;
  const alpha = Number(value) / (percent ? 100 : 1);
  return Number.isFinite(alpha) ? channel(alpha) : 1;
};

/**
 * A colour as a person may type it: hex (the "#" optional), `rgb()`, `hsl()` or
 * `oklch()`, modern or comma syntax. Null when it is none of those.
 */
export function parseTypedColor(text: string): Rgba | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/^#?[\da-f]{3,8}$/i.test(raw)) return parseColor(raw.startsWith("#") ? raw : `#${raw}`);

  const hsl = HSL_TEXT.exec(raw);
  if (hsl) {
    const base = parseColor(
      fromHsl({
        h: ((Number(hsl[1]) % 360) + 360) % 360,
        s: channel(Number(hsl[2]) / 100),
        l: channel(Number(hsl[3]) / 100),
      }),
    );
    return base ? { ...base, a: unitAlpha(hsl[4], hsl[5]) } : null;
  }

  const oklch = OKLCH_TEXT.exec(raw);
  if (oklch) {
    const lightness = Number(oklch[1]) / (oklch[2] ? 100 : 1);
    const chroma = Number(oklch[3]);
    const hue = ((Number(oklch[4]) % 360) + 360) % 360;
    if (![lightness, chroma, hue].every(Number.isFinite) || chroma < 0) return null;
    return {
      ...oklchToRgb({ l: channel(lightness), c: chroma, h: hue }),
      a: unitAlpha(oklch[5], oklch[6]),
    };
  }

  return parseColor(raw);
}

/** `#rrggbb`, with `aa` appended only when the colour is not fully opaque. */
export function rgbaToHex(color: Rgba): string {
  const hex = toHex(color);
  if (color.a >= 1) return hex;
  return `${hex}${Math.round(channel(color.a) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/**
 * How `value` (a hex, `#rrggbb` or `#rrggbbaa`) reads in `format`. Hex comes
 * back untouched so a field never rewrites what the merchant stored.
 */
export function formatColor(value: string, format: ColorFormat): string {
  if (format === "hex") return value;
  const color = parseColor(value);
  if (!color) return value;
  const alpha = color.a < 1 ? ` / ${Math.round(color.a * 100)}%` : "";
  if (format === "rgb") {
    return `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)}${alpha})`;
  }
  if (format === "hsl") {
    const hsl = toHsl(value);
    if (!hsl) return value;
    return `hsl(${Math.round(hsl.h)} ${Math.round(hsl.s * 100)}% ${Math.round(hsl.l * 100)}%${alpha})`;
  }
  const { l, c, h } = rgbToOklch(color);
  return `oklch(${+l.toFixed(3)} ${+c.toFixed(3)} ${+h.toFixed(1) % 360}${alpha})`;
}
