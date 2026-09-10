/**
 * Colour-swatch helpers shared by the storefront product card and its AI-studio
 * preview replica, so both resolve option colours to the same hex values.
 */

const COLOR_SWATCH_MAP: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  purple: "#a855f7",
  pink: "#ec4899",
  black: "#171717",
  white: "#ffffff",
  gray: "#6b7280",
  grey: "#6b7280",
  brown: "#92400e",
  navy: "#1e3a8a",
  beige: "#d4c4a8",
  cream: "#fffdd0",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  emerald: "#10b981",
  "light blue": "#93c5fd",
  "dark blue": "#1e40af",
  "light green": "#86efac",
  "dark green": "#166534",
  "light pink": "#fbcfe8",
  "dark pink": "#be185d",
  coral: "#f87171",
  salmon: "#fca5a5",
  maroon: "#7f1d1d",
  olive: "#84cc16",
  mint: "#a7f3d0",
  lavender: "#c4b5fd",
  burgundy: "#881337",
  charcoal: "#374151",
  ivory: "#fef3c7",
  gold: "#fbbf24",
  silver: "#9ca3af",
  rose: "#fb7185",
  peach: "#fed7aa",
  turquoise: "#5eead4",
  tan: "#d6b88e",
  khaki: "#c2b280",
  magenta: "#d946ef",
  lime: "#a3e635",
  indigo: "#6366f1",
  violet: "#8b5cf6",
};

/** Resolve a colour option value to a hex code (explicit code wins). */
export function getSwatchColor(value: string, colorCode?: string): string | null {
  if (colorCode) return colorCode;
  const normalized = value.toLowerCase().trim();
  return COLOR_SWATCH_MAP[normalized] || null;
}

// Reused canvas context for the CSS-name fallback below.
let colorProbeCtx: CanvasRenderingContext2D | null | undefined;

/**
 * Resolve a free-typed colour name to a hex swatch for admin variant editors
 * (Global Variants, product/category options). Prefers the curated
 * COLOR_SWATCH_MAP so admin swatches match what the storefront renders, then
 * falls back to the browser's own CSS colour parser for other valid names
 * ("teal", "salmon", "navy", …).
 *
 * Returns null for names that aren't recognisable colours (e.g. "titanium red",
 * "cosmic orange") so callers can fall back to their default swatch. Runs
 * map-only during SSR (no `document`).
 */
export function resolveColorNameToHex(name: string): string | null {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return null;

  const mapped = COLOR_SWATCH_MAP[normalized];
  if (mapped) return mapped;

  if (typeof document === "undefined") return null;
  if (colorProbeCtx === undefined) {
    colorProbeCtx = document.createElement("canvas").getContext("2d");
  }
  const ctx = colorProbeCtx;
  if (!ctx) return null;

  // An invalid fillStyle is ignored, leaving the previous value in place.
  // Probing against two different defaults means a valid colour yields the
  // same result twice, while an invalid one leaks the two defaults through.
  ctx.fillStyle = "#000000";
  ctx.fillStyle = normalized;
  const first = ctx.fillStyle;
  ctx.fillStyle = "#ffffff";
  ctx.fillStyle = normalized;
  const second = ctx.fillStyle;
  if (first !== second) return null;

  return typeof first === "string" && /^#[0-9a-f]{6}$/i.test(first)
    ? first.toLowerCase()
    : null;
}

/** True when an option name denotes colour ("Color" / "Colour", any case). */
export function isColorOptionName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("color") || normalized.includes("colour");
}

/** The first colour-typed option in a list, if any. */
export function findColorOption<T extends { name: string }>(
  options?: T[],
): T | undefined {
  return (options || []).find((option) => isColorOptionName(option.name));
}

/**
 * The product shape the colour→image lookup below reads. Structural on
 * purpose: the storefront card, the product page and the admin preview each
 * carry these fields under a slightly different type.
 */
type ColorImageSource = {
  images?: string[];
  media?: { _id?: string; url?: string }[];
  variants?: {
    image?: string;
    mediaId?: string;
    optionValues?: { valueId?: string; value?: string }[];
  }[];
};

/**
 * The image a colour swatch stands for: the media of the variant wearing that
 * colour — `mediaId` into the product's media, else the variant's own legacy
 * `image`. Null when no variant claims the colour or the one that does brings
 * no media of its own, so callers keep whatever image they were showing.
 */
export function findColorVariantImage(
  product: ColorImageSource,
  color: { _id?: string; value?: string },
): string | null {
  const wanted = color.value?.toLowerCase().trim();
  const variant = (product.variants || []).find((v) =>
    (v.optionValues || []).some(
      (ov) =>
        (!!color._id && ov.valueId === color._id) ||
        (!!wanted && ov.value?.toLowerCase().trim() === wanted),
    ),
  );
  if (!variant) return null;

  const fromMedia = variant.mediaId
    ? (product.media || []).find((m) => m._id === variant.mediaId)?.url
    : undefined;
  return fromMedia || variant.image || null;
}
