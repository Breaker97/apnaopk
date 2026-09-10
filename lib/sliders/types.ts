/**
 * Reusable sliders — the shared vocabulary.
 *
 * A Slider is an admin-authored, store-wide resource (like a Menu): a named
 * group of slides that content blocks reference BY HANDLE instead of owning
 * their own slide copies. This module is deliberately pure — no server, no
 * component imports — so the admin editor, the storefront renderer, and the
 * write-path normalizer all share one contract and the tamper-proofing is
 * unit-testable.
 *
 * The money invariant carries over from the slideshow section: a slide has NO
 * price field. `productId` binds a product; price resolves server-side at
 * render, so a slide can never advertise a stale or invented figure.
 */
import {
  readBoolean,
  readNumber,
} from "@/lib/site-config/normalize-primitives";
import type { CSSProperties } from "react";


/**
 * A slide is arranged per SHAPE, not per device.
 *
 * The same saved slider is reused across cells that are nothing like each
 * other — a full-bleed hero, a square bento tile, a tall side panel — and the
 * cell's proportions, not the viewer's screen, are what decide whether the
 * copy has room beside the artwork or has to stack above it. A phone in a
 * wide cell wants the landscape arrangement; a tall cell on a desktop wants
 * the portrait one. Keying off the device would get both backwards.
 */
export const SLIDE_SHAPES = ["landscape", "square", "portrait"] as const;
export type SlideShape = (typeof SLIDE_SHAPES)[number];

/**
 * Where one shape ends and the next begins, as a width/height ratio.
 *
 * The square band is deliberately generous: 4:3 (1.333) and 3:4 (0.75) read
 * as "roughly square" to a designer, and an arrangement built for 1:1 holds
 * up in both. 3:2 (1.5) and 2:3 (0.667) are the first ratios that genuinely
 * want a different arrangement, so the cuts sit just inside them.
 */
export const SLIDE_SHAPE_MIN_LANDSCAPE = 1.4;
export const SLIDE_SHAPE_MAX_PORTRAIT = 1 / 1.4;

/** Which arrangement a container of this width/height ratio should wear. */
export function shapeForAspect(ratio: number): SlideShape {
  if (!Number.isFinite(ratio) || ratio <= 0) return "landscape";
  if (ratio >= SLIDE_SHAPE_MIN_LANDSCAPE) return "landscape";
  if (ratio <= SLIDE_SHAPE_MAX_PORTRAIT) return "portrait";
  return "square";
}

/**
 * The proportion each shape is previewed at. Landscape uses the storefront
 * cell's own declared aspect; the other two are the plain centre of their
 * band, because a cell in that band can be anything.
 */
export const SLIDE_SHAPE_RATIO: Record<SlideShape, number> = {
  landscape: 16 / 7,
  square: 1,
  portrait: 9 / 16,
};

/** Elements the toolbar can toggle on a slide. */

export type SlideElement = "heading" | "description" | "tagline" | "price" | "cta" | "countdown";

/** Elements that carry editable text (and therefore per-text styling). */
const SLIDE_TEXT_ELEMENTS = [
  "tagline",
  "heading",
  "description",
  "cta",
] as const;
export type SlideTextElement = (typeof SLIDE_TEXT_ELEMENTS)[number];

export const SLIDE_FONT_WEIGHTS = [
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
] as const;
export type SlideFontWeight = (typeof SLIDE_FONT_WEIGHTS)[number];

export interface SlideTextStyle {
  weight?: SlideFontWeight;
  style?: "normal" | "italic";
  /** Desktop base size in px; tablet/mobile scale via the layout's `scale`. */
  size?: number;
  color?: string;
  /**
   * Text BOX width, as a percent of the slide. Every text box has a definite
   * width (this, or the element's default) — which is also what keeps the
   * editor's style/AI buttons anchored: they ride the box's top-right corner,
   * so a box that shrink-wrapped its text would move them on every keystroke.
   */
  width?: number;
  /**
   * CTA only: the button's padding in px. Unset = the em-based default that
   * scales with the label (see `ctaPaddingCss`).
   */
  paddingX?: number;
  paddingY?: number;
  /** CTA only: a fixed button height in px; unset = as tall as its padding. */
  height?: number;
}

/**
 * The CTA button's padding, shared by the storefront button and the editor
 * canvas: `em` by default so the chrome grows and shrinks with its label,
 * or the merchant's px when set (per axis — one can stay automatic).
 */
function ctaPaddingCss(style: SlideTextStyle): string {
  const y = style.paddingY !== undefined ? `${style.paddingY}px` : "0.7em";
  const x = style.paddingX !== undefined ? `${style.paddingX}px` : "1.6em";
  return `${y} ${x}`;
}

/** The CTA button's box: padding, plus a fixed height when one is set. */
export function ctaBoxCss(style: SlideTextStyle): {
  padding: string;
  minHeight?: string;
} {
  return {
    padding: ctaPaddingCss(style),
    ...(style.height ? { minHeight: `${style.height}px` } : {}),
  };
}

type SlideStyleMap = Partial<Record<SlideTextElement, SlideTextStyle>>;

export const SLIDE_H_ALIGN = ["left", "center", "right"] as const;
export const SLIDE_V_ALIGN = ["top", "middle", "bottom"] as const;
export type SlideHAlign = (typeof SLIDE_H_ALIGN)[number];
export type SlideVAlign = (typeof SLIDE_V_ALIGN)[number];

/**
 * How the content group sits inside the slide for one device. Tablet and
 * mobile store PARTIAL overrides — anything unset falls through to desktop,
 * so a slide arranged once looks right everywhere until the admin says
 * otherwise.
 */
export interface SlideLayout {
  h: SlideHAlign;
  v: SlideVAlign;
  /** Gap between stacked content elements, px. */
  gap: number;
  /** Content scale percent (text sizes multiply by this / 100). */
  scale: number;
}

/**
 * How the product artwork sits inside the slide, for one device.
 *
 * The artwork is its OWN layer, behind the copy and independent of it: the
 * two are placed against the same canvas and are free to overlap, which is
 * what the design does (headline over the cutout's soft edge). Alignment
 * picks the anchor, `x`/`y` nudge off it, `scale` is the artwork's width as a
 * percent of the slide, `rotation` spins it in place.
 */
export interface SlideImageLayout {
  h: SlideHAlign;
  v: SlideVAlign;
  /**
   * Artwork width as a percent of the slide width, 5–200. Past 100 the
   * cutout is wider than the slide and the frame crops it — a deliberate
   * "zoom into the product" look, not an error.
   */
  scale: number;
  /** Degrees, -180..180. */
  rotation: number;
  /** Nudge off the anchor, percent of the slide's own width/height. */
  x: number;
  y: number;
}

/**
 * The CTA button's chrome. Text styling (size, weight, color) stays with the
 * per-element style popover; the variant decides the plate behind it.
 */
export const SLIDE_CTA_VARIANTS = ["dark", "light", "outline"] as const;
export type SlideCtaVariant = (typeof SLIDE_CTA_VARIANTS)[number];

/**
 * The chrome each variant renders — shared by the storefront button and the
 * editor canvas so the preview cannot drift. The outline border follows
 * `currentColor`, so recoloring the label recolors the ring with it.
 */
export function ctaVariantChrome(variant: SlideCtaVariant): {
  background: string;
  border: string;
  /** Default label color; a per-element color override still wins. */
  textColor: string;
} {
  switch (variant) {
    case "light":
      return { background: "#ffffff", border: "none", textColor: "#1f2937" };
    case "outline":
      return {
        background: "transparent",
        border: "1px solid currentColor",
        textColor: "#1f2937",
      };
    default:
      return { background: "#1f2937", border: "none", textColor: "#ffffff" };
  }
}

export const SLIDE_REVEALS = [
  "none",
  "fade",
  "rise",
  "slide-right",
  "slide-left",
  "zoom",
] as const;
type SlideReveal = (typeof SLIDE_REVEALS)[number];

export const SLIDER_TRANSITIONS = ["slide", "fade"] as const;
export type SliderTransition = (typeof SLIDER_TRANSITIONS)[number];

export interface SlideGradient {
  /** "linear" uses `angle`; "radial" is the direction pad's centre dot. */
  type: "linear" | "radial";
  /** CSS angle in degrees (0 = to top), for linear gradients. */
  angle: number;
  /** 2..6 stops, `at` in 0..100, kept sorted by `at`. */
  stops: { color: string; at: number }[];
}

export interface SlideBackground {
  type: "solid" | "gradient" | "image";
  color?: string;
  gradient?: SlideGradient;
  image?: string;
}

export interface SliderSlide {
  id: string;
  visible: boolean;
  /** Which elements render. Text values survive a toggle-off. */
  elements: Record<SlideElement, boolean>;
  texts: {
    tagline: string;
    heading: string;
    description: string;
    cta: string;
  };
  /** The CTA button's chrome: dark plate, light plate, or outlined. */
  ctaVariant: SlideCtaVariant;
  /**
   * Type styling, per shape and per property. A headline that carries a wide
   * cell at 42px is unreadable crammed into a tall one, so size — and weight,
   * slant, colour, box width with it — is something each band states for
   * itself. Square and portrait hold only what they CHANGE: every property
   * falls through to landscape on its own, so overriding the size in portrait
   * keeps the weight and colour you set once.
   */
  styles: {
    landscape: SlideStyleMap;
    square?: SlideStyleMap;
    portrait?: SlideStyleMap;
  };
  /** Explicit link; a bound product supplies the fallback destination. */
  link: string;
  /** Product binding — the ONLY source of the Price element. */
  productId: string;
  /** Artwork placed beside the text content (the design's product cutout). */
  productImage: string;
  countdownEndsAt: string;
  reveal: SlideReveal;
  background: SlideBackground;
  layout: {
    landscape: SlideLayout;
    square?: Partial<SlideLayout>;
    portrait?: Partial<SlideLayout>;
  };
  /** The artwork layer's own placement, same per-device fallthrough. */
  image: {
    landscape: SlideImageLayout;
    square?: Partial<SlideImageLayout>;
    portrait?: Partial<SlideImageLayout>;
  };
  alt: string;
}

/** A Slider document, as stored (`sliders` collection) and as the API ships it. */
export interface SliderDocument {
  _id?: string;
  name: string;
  handle: string;
  isActive: boolean;
  transition: SliderTransition;
  autoplaySeconds: number;
  slides: SliderSlide[];
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export const MAX_SLIDES_PER_SLIDER = 20;

/**
 * How long a slide holds before the next one. Stated once here because the
 * bound is enforced in four places — the editor's rail, the zod schema, the
 * Mongoose field, and the read-side clamp — and a control offering a value
 * the API would reject is a bug waiting to happen.
 */
export const MIN_AUTOPLAY_SECONDS = 3;
export const MAX_AUTOPLAY_SECONDS = 10;
export const DEFAULT_AUTOPLAY_SECONDS = 5;

/** Clamp a stored/typed delay into the range every layer agrees on. */
export function clampAutoplaySeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AUTOPLAY_SECONDS;
  }
  return Math.min(MAX_AUTOPLAY_SECONDS, Math.max(MIN_AUTOPLAY_SECONDS, value));
}

/**
 * The Tailwind aspect each shape is framed at. The editor canvas and the
 * collapsed card on the Sliders page both use these, so what you arrange in
 * one shape is exactly what the card plays back for that shape.
 *
 * Landscape is the storefront cell's own declared aspect
 * (`aspect-[16/7]` in `sections/definitions/slideshow.tsx`) — keep the two in
 * step. A live cell can of course land anywhere inside a band; that is the
 * point of arranging by band rather than by pixel.
 */
export const SLIDE_SHAPE_ASPECT_CLASS: Record<SlideShape, string> = {
  landscape: "aspect-[16/7]",
  square: "aspect-square",
  portrait: "aspect-[9/16]",
};

/** Height the editor frames every shape at, so switching shape doesn't jump. */
export const EDITOR_CANVAS_HEIGHT = 430;

/**
 * The width each band's stored lengths are stated AT.
 *
 * Sizes are kept as plain px because that is what a person types, but a slide
 * is reused at wildly different sizes — the same square arrangement lands in a
 * 430px editor canvas and a 310px bento tile. Holding 37px literal in both
 * makes the small one look shouted. So every length is rendered as a SHARE of
 * the slide's width: 37px at a 430-wide reference is 8.6% of the width, and it
 * stays 8.6% wherever the slide goes.
 *
 * The references are the editor's own canvas widths, which makes the editor
 * WYSIWYG at its default size — the number in the style panel is the number of
 * pixels you are looking at.
 */
export const SLIDE_SHAPE_REFERENCE_WIDTH: Record<SlideShape, number> = {
  landscape: Math.round(EDITOR_CANVAS_HEIGHT * (16 / 7)),
  square: EDITOR_CANVAS_HEIGHT,
  portrait: Math.round(EDITOR_CANVAS_HEIGHT * (9 / 16)),
};

/**
 * A length stated at the band's reference width, as a container-query width
 * unit. Both surfaces make the slide a size container (`.sl-frame` on the
 * storefront, `.sl-canvas` in the editor), so `cqw` means the same thing in
 * each and the two cannot drift.
 */
export function cqw(px: number, shape: SlideShape): string {
  const share = (px / SLIDE_SHAPE_REFERENCE_WIDTH[shape]) * 100;
  return `${Number(share.toFixed(4))}cqw`;
}

/** Type never shrinks below this, however small the cell gets. */
export const MIN_TEXT_PX = 9;

/**
 * A text's rendered size for one band, as a share of the slide's width.
 *
 * A size is always read against the band it is rendering in — inherited or
 * not. That is what makes the editor honest: its square canvas is the square
 * reference wide, so "37px" in the panel is 37px on screen, and a real square
 * cell scales from exactly that. The consequence worth knowing is that a size
 * set only in landscape occupies a LARGER share in the square and portrait
 * bands, whose references are smaller — tune the band if that is not what you
 * want. (An earlier build made inherited sizes carry landscape's share
 * instead; it kept the bands visually identical but made the editor lie about
 * every band it was not currently showing.)
 *
 * BOTH surfaces must call this. The editor once computed the same thing
 * inline and drifted from the storefront by a factor of two.
 */
export function textSizeCqw(
  slide: SliderSlide,
  element: SlideTextElement,
  shape: SlideShape,
): string {
  return cqw(resolveTextStyle(slide, element, shape).size, shape);
}

/**
 * A size no band can override (the price line). It still has to scale with
 * the slide, so it is stated at the band's own reference like everything else.
 */
export function fixedSizeVars(px: number): Record<string, string> {
  return {
    "--fs-l": cqw(px, "landscape"),
    "--fs-s": cqw(px, "square"),
    "--fs-p": cqw(px, "portrait"),
  };
}

/**
 * Inset of each layer from the slide's edge, per shape, in px.
 *
 * The storefront applies these through the container-query blocks in
 * `globals.css` (which read the CELL's aspect); the editor applies them
 * INLINE, because its shape toggle previews a forced band that no query can
 * see. Same numbers, two mechanisms — change one and change the other, or the
 * canvas starts lying about where the copy sits.
 */
export const SLIDE_COPY_PADDING: Record<SlideShape, number> = {
  portrait: 20,
  square: 32,
  landscape: 48,
};

export const SLIDE_ART_PADDING: Record<SlideShape, number> = {
  portrait: 16,
  square: 24,
  landscape: 24,
};

const DEFAULT_SLIDE_LAYOUT: SlideLayout = {
  h: "left",
  v: "middle",
  gap: 12,
  scale: 100,
};

const DEFAULT_IMAGE_LAYOUT: SlideImageLayout = {
  h: "right",
  v: "middle",
  scale: 40,
  rotation: 0,
  x: 0,
  y: 0,
};

export const DEFAULT_TEXT_SIZES: Record<SlideTextElement, number> = {
  tagline: 14,
  heading: 40,
  description: 16,
  cta: 14,
};

/**
 * Text box widths (percent of the slide) when the admin hasn't set one. The
 * copy leaves room for the artwork by default; `0` means shrink-to-fit, which
 * is what a CTA button wants.
 */
export const DEFAULT_TEXT_WIDTHS: Record<SlideTextElement, number> = {
  tagline: 45,
  heading: 50,
  description: 45,
  cta: 0,
};

export function createSlide(id: string): SliderSlide {
  return {
    id,
    visible: true,
    elements: {
      heading: true,
      description: false,
      tagline: false,
      price: false,
      cta: true,
      countdown: false,
    },
    texts: { tagline: "", heading: "", description: "", cta: "" },
    ctaVariant: "dark",
    styles: { landscape: {} },
    link: "",
    productId: "",
    productImage: "",
    countdownEndsAt: "",
    reveal: "fade",
    background: { type: "solid", color: "#f1f1f1" },
    layout: { landscape: { ...DEFAULT_SLIDE_LAYOUT } },
    image: { landscape: { ...DEFAULT_IMAGE_LAYOUT } },
    alt: "",
  };
}

/* ------------------------------------------------------------------ */
/* Normalization — every read and write passes stored slides through   */
/* this, so tampering (or an older document shape) can never render a  */
/* value the contract doesn't allow.                                   */
/* ------------------------------------------------------------------ */

/**
 * Three, six or eight hex digits: the eight-digit form carries an alpha
 * channel, which is how a background says "60% white" — one value, painted
 * by the browser, no separate opacity to keep in step with the colour.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function str(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function color(value: unknown): string | undefined {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : undefined;
}

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function normalizeTextStyle(raw: unknown): SlideTextStyle | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const style: SlideTextStyle = {};
  if (SLIDE_FONT_WEIGHTS.includes(source.weight as SlideFontWeight)) {
    style.weight = source.weight as SlideFontWeight;
  }
  if (source.style === "italic" || source.style === "normal") {
    style.style = source.style;
  }
  if (typeof source.size === "number" && Number.isFinite(source.size)) {
    style.size = readNumber(source.size, 16, 8, 120);
  }
  if (typeof source.width === "number" && Number.isFinite(source.width)) {
    // 0 is meaningful — it means shrink-to-fit.
    style.width = readNumber(source.width, 0, 0, 100);
  }
  if (typeof source.paddingX === "number" && Number.isFinite(source.paddingX)) {
    style.paddingX = readNumber(source.paddingX, 0, 0, 120);
  }
  if (typeof source.paddingY === "number" && Number.isFinite(source.paddingY)) {
    style.paddingY = readNumber(source.paddingY, 0, 0, 120);
  }
  if (typeof source.height === "number" && Number.isFinite(source.height)) {
    style.height = readNumber(source.height, 0, 0, 160);
  }
  const c = color(source.color);
  if (c) style.color = c;
  return Object.keys(style).length > 0 ? style : undefined;
}

function normalizeLayout(raw: unknown): SlideLayout {
  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    h: oneOf(source.h, SLIDE_H_ALIGN, DEFAULT_SLIDE_LAYOUT.h),
    v: oneOf(source.v, SLIDE_V_ALIGN, DEFAULT_SLIDE_LAYOUT.v),
    gap: readNumber(source.gap, DEFAULT_SLIDE_LAYOUT.gap, 0, 60),
    scale: readNumber(source.scale, DEFAULT_SLIDE_LAYOUT.scale, 40, 200),
  };
}

function normalizePartialLayout(raw: unknown): Partial<SlideLayout> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const layout: Partial<SlideLayout> = {};
  if (SLIDE_H_ALIGN.includes(source.h as SlideHAlign)) {
    layout.h = source.h as SlideHAlign;
  }
  if (SLIDE_V_ALIGN.includes(source.v as SlideVAlign)) {
    layout.v = source.v as SlideVAlign;
  }
  if (typeof source.gap === "number") layout.gap = readNumber(source.gap, 12, 0, 60);
  if (typeof source.scale === "number") {
    layout.scale = readNumber(source.scale, 100, 40, 200);
  }
  return Object.keys(layout).length > 0 ? layout : undefined;
}

function normalizeImageLayout(raw: unknown): SlideImageLayout {
  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    h: oneOf(source.h, SLIDE_H_ALIGN, DEFAULT_IMAGE_LAYOUT.h),
    v: oneOf(source.v, SLIDE_V_ALIGN, DEFAULT_IMAGE_LAYOUT.v),
    scale: readNumber(source.scale, DEFAULT_IMAGE_LAYOUT.scale, 5, 200),
    rotation: readNumber(source.rotation, 0, -180, 180),
    x: readNumber(source.x, 0, -50, 50),
    y: readNumber(source.y, 0, -50, 50),
  };
}

function normalizePartialImageLayout(
  raw: unknown,
): Partial<SlideImageLayout> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const layout: Partial<SlideImageLayout> = {};
  if (SLIDE_H_ALIGN.includes(source.h as SlideHAlign)) {
    layout.h = source.h as SlideHAlign;
  }
  if (SLIDE_V_ALIGN.includes(source.v as SlideVAlign)) {
    layout.v = source.v as SlideVAlign;
  }
  if (typeof source.scale === "number") {
    layout.scale = readNumber(source.scale, 40, 5, 200);
  }
  if (typeof source.rotation === "number") {
    layout.rotation = readNumber(source.rotation, 0, -180, 180);
  }
  if (typeof source.x === "number") layout.x = readNumber(source.x, 0, -50, 50);
  if (typeof source.y === "number") layout.y = readNumber(source.y, 0, -50, 50);
  return Object.keys(layout).length > 0 ? layout : undefined;
}

function normalizeGradient(raw: unknown): SlideGradient | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const stops = (Array.isArray(source.stops) ? source.stops : [])
    .map((stop) => {
      const entry =
        typeof stop === "object" && stop !== null
          ? (stop as Record<string, unknown>)
          : {};
      const c = color(entry.color);
      if (!c) return null;
      return { color: c, at: readNumber(entry.at, 0, 0, 100) };
    })
    .filter((stop): stop is { color: string; at: number } => stop !== null)
    .sort((a, b) => a.at - b.at)
    .slice(0, 6);
  if (stops.length < 2) return undefined;
  return {
    type: source.type === "radial" ? "radial" : "linear",
    angle: readNumber(source.angle, 0, 0, 359),
    stops,
  };
}

/**
 * Exported because the same contract now backs every "background" the
 * admin edits — the header studio's rows and items and the section field
 * type of that name — not just a slide.
 */
export function normalizeBackground(raw: unknown): SlideBackground {
  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const type = oneOf(source.type, ["solid", "gradient", "image"] as const, "solid");
  const background: SlideBackground = { type };
  const solid = color(source.color);
  if (solid) background.color = solid;
  const gradient = normalizeGradient(source.gradient);
  if (gradient) background.gradient = gradient;
  const image = str(source.image, 1000);
  if (image) background.image = image;
  // A background whose chosen type has no value falls back to solid so the
  // slide never renders as a hole.
  if (type === "gradient" && !gradient) background.type = "solid";
  if (type === "image" && !image) background.type = "solid";
  return background;
}

function normalizeSlide(raw: unknown, index: number): SliderSlide {
  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const elementsSource =
    typeof source.elements === "object" && source.elements !== null
      ? (source.elements as Record<string, unknown>)
      : {};
  const textsSource =
    typeof source.texts === "object" && source.texts !== null
      ? (source.texts as Record<string, unknown>)
      : {};
  const stylesSource =
    typeof source.styles === "object" && source.styles !== null
      ? (source.styles as Record<string, unknown>)
      : {};
  const layoutSource =
    typeof source.layout === "object" && source.layout !== null
      ? (source.layout as Record<string, unknown>)
      : {};
  const imageSource =
    typeof source.image === "object" && source.image !== null
      ? (source.image as Record<string, unknown>)
      : {};

  // Styling used to be one flat map shared by every shape. A document in that
  // shape has text-element keys at the top level and no band keys, so the old
  // map simply becomes the landscape band — which is the one it was authored
  // against — and the other two start empty, inheriting all of it.
  const legacyFlat = !SLIDE_SHAPES.some(
    (shape) => typeof stylesSource[shape] === "object",
  );
  const styleMapAt = (raw: unknown): SlideStyleMap => {
    const source =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)
        : {};
    const map: SlideStyleMap = {};
    for (const element of SLIDE_TEXT_ELEMENTS) {
      const style = normalizeTextStyle(source[element]);
      if (style) map[element] = style;
    }
    return map;
  };
  const styles: SliderSlide["styles"] = {
    landscape: styleMapAt(legacyFlat ? stylesSource : stylesSource.landscape),
  };
  if (!legacyFlat) {
    for (const shape of ["square", "portrait"] as const) {
      const map = styleMapAt(stylesSource[shape]);
      if (Object.keys(map).length > 0) styles[shape] = map;
    }
  }

  const background = normalizeBackground(source.background);

  const slide: SliderSlide = {
    id: str(source.id, 64) || `slide-${index + 1}`,
    visible: readBoolean(source.visible, true),
    elements: {
      heading: readBoolean(elementsSource.heading, true),
      description: readBoolean(elementsSource.description, false),
      tagline: readBoolean(elementsSource.tagline, false),
      price: readBoolean(elementsSource.price, false),
      cta: readBoolean(elementsSource.cta, false),
      countdown: readBoolean(elementsSource.countdown, false),
    },
    texts: {
      tagline: str(textsSource.tagline, 200),
      heading: str(textsSource.heading, 300),
      description: str(textsSource.description, 600),
      cta: str(textsSource.cta, 80),
    },
    // Documents older than the variant rendered a white button over image
    // backgrounds and a dark one otherwise — the default preserves exactly
    // that reading, so no existing slider changes look.
    ctaVariant: oneOf(
      source.ctaVariant,
      SLIDE_CTA_VARIANTS,
      background.type === "image" ? "light" : "dark",
    ),
    styles,
    link: str(source.link, 600),
    productId: str(source.productId, 64),
    productImage: str(source.productImage, 1000),
    countdownEndsAt:
      typeof source.countdownEndsAt === "string" &&
      source.countdownEndsAt &&
      !Number.isNaN(Date.parse(source.countdownEndsAt))
        ? source.countdownEndsAt
        : "",
    reveal: oneOf(source.reveal, SLIDE_REVEALS, "fade"),
    background,
    layout: {
      landscape: normalizeLayout(
        layoutSource.landscape ?? layoutSource.desktop,
      ),
    },
    image: {
      landscape: normalizeImageLayout(
        imageSource.landscape ?? imageSource.desktop,
      ),
    },
    alt: str(source.alt, 300),
  };
  // Documents written against the device model carry desktop/tablet/mobile.
  // The reading is the same one a designer would make — a desktop hero is
  // wide, a phone is tall — so the old keys map straight onto the bands and
  // an existing slider keeps its arrangement without anyone re-doing it.
  const square = normalizePartialLayout(
    layoutSource.square ?? layoutSource.tablet,
  );
  if (square) slide.layout.square = square;
  const portrait = normalizePartialLayout(
    layoutSource.portrait ?? layoutSource.mobile,
  );
  if (portrait) slide.layout.portrait = portrait;
  const imageSquare = normalizePartialImageLayout(
    imageSource.square ?? imageSource.tablet,
  );
  if (imageSquare) slide.image.square = imageSquare;
  const imagePortrait = normalizePartialImageLayout(
    imageSource.portrait ?? imageSource.mobile,
  );
  if (imagePortrait) slide.image.portrait = imagePortrait;
  return slide;
}

export function normalizeSlides(raw: unknown): SliderSlide[] {
  const list = Array.isArray(raw) ? raw : [];
  const slides = list
    .slice(0, MAX_SLIDES_PER_SLIDER)
    .map((slide, index) => normalizeSlide(slide, index));
  // Ids must be unique — thumbnails, dnd, and AI draft keys all key off them.
  const seen = new Set<string>();
  for (const slide of slides) {
    while (seen.has(slide.id)) slide.id = `${slide.id}-x`;
    seen.add(slide.id);
  }
  return slides;
}

/* ------------------------------------------------------------------ */
/* Render helpers, shared by the editor canvas and the storefront.     */
/* ------------------------------------------------------------------ */

/** Square and portrait fall through to landscape for anything unset. */
export function resolveSlideLayout(
  slide: SliderSlide,
  shape: SlideShape,
): SlideLayout {
  const base = slide.layout.landscape;
  if (shape === "landscape") return base;
  return { ...base, ...(slide.layout[shape] ?? {}) };
}

export function resolveImageLayout(
  slide: SliderSlide,
  shape: SlideShape,
): SlideImageLayout {
  const base = slide.image.landscape;
  if (shape === "landscape") return base;
  return { ...base, ...(slide.image[shape] ?? {}) };
}

/** Whether the chosen mode actually has something to paint. */
export function hasBackground(background: SlideBackground): boolean {
  switch (background.type) {
    case "solid":
      return Boolean(background.color);
    case "gradient":
      return Boolean(background.gradient);
    case "image":
      return Boolean(background.image);
  }
}

/**
 * The background as inline style. Empty when nothing is set, so a caller
 * can spread it and let the surface's own paint show through. Images are
 * covered and centred — a header row is wide and short, and a stretched
 * photo reads as broken where a cropped one reads as a banner.
 */
export function backgroundCss(background: SlideBackground): CSSProperties {
  if (background.type === "gradient" && background.gradient) {
    return { backgroundImage: buildGradientCss(background.gradient) };
  }
  if (background.type === "image" && background.image) {
    return {
      backgroundImage: `url("${background.image.replace(/["\\]/g, "")}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  if (background.type === "solid" && background.color) {
    return { backgroundColor: background.color };
  }
  return {};
}

/**
 * One colour standing in for the whole background — what a border or an
 * outline takes when the fill itself is a gradient or a photo.
 */
export function backgroundAccentColor(
  background: SlideBackground,
): string | undefined {
  if (background.type === "gradient") return background.gradient?.stops[0]?.color;
  if (background.type === "image") return undefined;
  return background.color;
}

export function buildGradientCss(gradient: SlideGradient): string {
  const stops = gradient.stops
    .map((stop) => `${stop.color} ${stop.at}%`)
    .join(", ");
  return gradient.type === "radial"
    ? `radial-gradient(circle at center, ${stops})`
    : `linear-gradient(${gradient.angle}deg, ${stops})`;
}

/** What a band actually STORES for one text — the override, not the result. */
export function ownTextStyle(
  slide: SliderSlide,
  element: SlideTextElement,
  shape: SlideShape,
): SlideTextStyle {
  return (
    (shape === "landscape"
      ? slide.styles.landscape[element]
      : slide.styles[shape]?.[element]) ?? {}
  );
}

/**
 * The style one text actually renders with in a band: landscape underneath,
 * the band's own overrides on top, property by property, then the element's
 * built-in defaults for anything still unset.
 */
export function resolveTextStyle(
  slide: SliderSlide,
  element: SlideTextElement,
  shape: SlideShape = "landscape",
): Required<Pick<SlideTextStyle, "size" | "width">> & SlideTextStyle {
  const style = {
    ...slide.styles.landscape[element],
    ...(shape === "landscape" ? {} : slide.styles[shape]?.[element]),
  };
  return {
    ...style,
    size: style.size ?? DEFAULT_TEXT_SIZES[element],
    width: style.width ?? DEFAULT_TEXT_WIDTHS[element],
  };
}

/**
 * A text's per-band styling as CSS custom properties, to be set INLINE on the
 * element itself.
 *
 * Declaring them on the element is what keeps the stylesheet small: one
 * generic `.sl-text` rule per band aliases `--fs-l|s|p` down to `--fs`, and
 * that same rule then serves every text on every slide. The alternative —
 * naming each element in the CSS — would be twenty declarations per band that
 * have to be kept in step with this file by hand.
 */
export function textStyleVars(
  slide: SliderSlide,
  element: SlideTextElement,
  fallbackColor: string,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [suffix, shape] of [
    ["l", "landscape"],
    ["s", "square"],
    ["p", "portrait"],
  ] as const) {
    const style = resolveTextStyle(slide, element, shape);
    vars[`--fs-${suffix}`] = textSizeCqw(slide, element, shape);
    // Defaults must match the editor canvas (slide-canvas.tsx) property for
    // property — the CTA renders at 500 there, so 400 here showed every
    // un-styled button lighter live than designed.
    vars[`--wt-${suffix}`] = String(
      style.weight ?? (element === "heading" ? 700 : element === "cta" ? 500 : 400),
    );
    vars[`--it-${suffix}`] = style.style ?? "normal";
    vars[`--co-${suffix}`] = style.color ?? fallbackColor;
    vars[`--wd-${suffix}`] = textBoxWidth(style.width);
  }
  return vars;
}

/**
 * The properties every `.sl-text` reads from the aliases above. The size is a
 * share of the slide's width with a floor, so a slide dropped into a small
 * tile shrinks with it instead of shouting over it — and never disappears.
 */
export const SLIDE_TEXT_CSS = {
  fontSize: `max(${MIN_TEXT_PX}px, calc(var(--fs) * var(--sl-scale, 1)))`,
  fontWeight: "var(--wt)",
  fontStyle: "var(--it)",
  color: "var(--co)",
  lineHeight: 1.2,
} as const;

/** The price line's own size, in the same width-relative terms. */
export const SLIDE_PRICE_PX = 26;

/** CSS width for a text box; `0` (shrink-to-fit) becomes `auto`. */
export function textBoxWidth(width: number): string {
  return width > 0 ? `${width}%` : "auto";
}

/**
 * The artwork layer's inline style. Shared by the storefront and the admin
 * canvas so a slide is arranged once and lands the same in both.
 */
export function imageLayerStyle(layout: SlideImageLayout): {
  container: { justifyContent: string; alignItems: string };
  art: { width: string; transform: string };
} {
  const justify = { left: "flex-start", center: "center", right: "flex-end" };
  const align = { top: "flex-start", middle: "center", bottom: "flex-end" };
  return {
    container: {
      justifyContent: justify[layout.h],
      alignItems: align[layout.v],
    },
    art: {
      width: `${layout.scale}%`,
      // Translate is expressed against the ARTWORK's own box, so the nudge
      // stays proportional as the artwork scales.
      transform: `translate(${layout.x * 2}%, ${layout.y * 2}%) rotate(${layout.rotation}deg)`,
    },
  };
}
