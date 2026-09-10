/**
 * The storefront font catalog. Every face is self-hosted under
 * `/public/fonts/storefront` (variable weight, SIL OFL) and declared once in
 * `app/fonts/storefront-faces.css`; the browser downloads a face only when a
 * rule paints text with it, so declaring the whole catalog is free.
 *
 * Runtime Google Fonts is deliberately not an option: CSP, privacy and
 * offline buyer installs. `tests/font-catalog.test.ts` pins that every entry
 * below has its woff2 and licence on disk.
 *
 * Pure module — the theme editor renders samples from it on the client and
 * the compiler reads it on the server.
 */
type FontCategory = "sans" | "serif" | "display";

interface FontFace {
  id: string;
  /** Display name, also the `font-family` string. */
  name: string;
  /** The CSS family declared in storefront-faces.css. */
  family: string;
  category: FontCategory;
  /** Files under /public/fonts/storefront, checked by the catalog test. */
  files: string[];
  /** One-line character note for the picker. */
  note: string;
}

const SANS_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const SERIF_FALLBACK = 'ui-serif, Georgia, "Times New Roman", serif';

export const FONT_CATALOG: FontFace[] = [
  { id: "inter", name: "Inter", family: "Inter Store", category: "sans", files: ["inter-latin.woff2"], note: "Neutral, technical, the default" },
  { id: "manrope", name: "Manrope", family: "Manrope", category: "sans", files: ["manrope-latin.woff2"], note: "Geometric, modern retail" },
  { id: "dm-sans", name: "DM Sans", family: "DM Sans", category: "sans", files: ["dm-sans-latin.woff2"], note: "Rounded, friendly" },
  { id: "plus-jakarta-sans", name: "Plus Jakarta Sans", family: "Plus Jakarta Sans", category: "sans", files: ["plus-jakarta-sans-latin.woff2"], note: "Soft geometric, lifestyle" },
  { id: "nunito", name: "Nunito", family: "Nunito", category: "sans", files: ["nunito-latin.woff2"], note: "Rounded terminals, playful" },
  { id: "source-sans-3", name: "Source Sans 3", family: "Source Sans 3", category: "sans", files: ["source-sans-3-latin.woff2"], note: "Humanist, long reads" },
  { id: "space-grotesk", name: "Space Grotesk", family: "Space Grotesk", category: "sans", files: ["space-grotesk-latin.woff2"], note: "Quirky grotesk, tech" },
  { id: "playfair-display", name: "Playfair Display", family: "Playfair Display", category: "serif", files: ["playfair-display-latin.woff2"], note: "High-contrast editorial" },
  { id: "lora", name: "Lora", family: "Lora", category: "serif", files: ["lora-latin.woff2"], note: "Calm, readable serif" },
  { id: "fraunces", name: "Fraunces", family: "Fraunces", category: "serif", files: ["fraunces-latin.woff2"], note: "Soft, warm, wellbeing" },
  { id: "cormorant-garamond", name: "Cormorant Garamond", family: "Cormorant Garamond", category: "serif", files: ["cormorant-garamond-latin.woff2"], note: "Luxury, fashion" },
  { id: "dm-serif-display", name: "DM Serif Display", family: "DM Serif Display", category: "display", files: ["dm-serif-display-latin.woff2"], note: "Headlines only (one weight)" },
  { id: "noto-sans-bengali", name: "Noto Sans Bengali", family: "Noto Sans Bengali", category: "sans", files: ["noto-sans-bengali-bengali.woff2", "noto-sans-bengali-latin.woff2"], note: "Bengali + Latin, sans" },
  { id: "noto-serif-bengali", name: "Noto Serif Bengali", family: "Noto Serif Bengali", category: "serif", files: ["noto-serif-bengali-bengali.woff2", "noto-serif-bengali-latin.woff2"], note: "Bengali + Latin, serif" },
];

/** Curated heading/body pairs the editor offers as one click. */
export const FONT_PAIRINGS: { key: string; name: string; heading: string; body: string }[] = [
  { key: "inter", name: "Inter / Inter", heading: "inter", body: "inter" },
  { key: "manrope-inter", name: "Manrope / Inter", heading: "manrope", body: "inter" },
  { key: "jakarta-dm", name: "Plus Jakarta / DM Sans", heading: "plus-jakarta-sans", body: "dm-sans" },
  { key: "grotesk-inter", name: "Space Grotesk / Inter", heading: "space-grotesk", body: "inter" },
  { key: "playfair-source", name: "Playfair / Source Sans", heading: "playfair-display", body: "source-sans-3" },
  { key: "cormorant-manrope", name: "Cormorant / Manrope", heading: "cormorant-garamond", body: "manrope" },
  { key: "fraunces-nunito", name: "Fraunces / Nunito", heading: "fraunces", body: "nunito" },
  { key: "dmserif-dmsans", name: "DM Serif / DM Sans", heading: "dm-serif-display", body: "dm-sans" },
  { key: "lora-source", name: "Lora / Source Sans", heading: "lora", body: "source-sans-3" },
];

export function getFontFace(id: unknown): FontFace | undefined {
  return FONT_CATALOG.find((face) => face.id === id);
}

export function isFontId(id: unknown): id is string {
  return typeof id === "string" && FONT_CATALOG.some((face) => face.id === id);
}

/** The full `font-family` stack for a catalog id (fallback stack included). */
export function fontFamilyStack(id: unknown): string | undefined {
  const face = getFontFace(id);
  if (!face) return undefined;
  const fallback = face.category === "sans" ? SANS_FALLBACK : SERIF_FALLBACK;
  return `"${face.family}", ${fallback}`;
}
