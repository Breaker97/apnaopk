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
import { readableForegroundColor } from "@/lib/site-config/appearance-colors";
import { isTrustedRemoteUrl } from "@/lib/remote-image-domains";
import type { CSSProperties } from "react";
import { color, hexChannels, oneOf, str } from "./normalize-values";
import {
  backgroundAccentColor,
  backgroundFilterCss,
  buildGradientCss,
  focalPositionCss,
  hasBackground,
  isArtwork,
  normalizeBackground,
  type SlideBackground,
} from "./background";

export * from "./background";

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
export const SLIDE_SHAPES = ["landscape", "tile", "square", "portrait"] as const;
export type SlideShape = (typeof SLIDE_SHAPES)[number];

/**
 * The bands that hold OVERRIDES. Landscape is the base every other band
 * falls through to, so it is the one band that stores a complete design.
 */
export const SLIDE_OVERRIDE_BANDS = ["tile", "square", "portrait"] as const;
export type SlideOverrideBand = (typeof SLIDE_OVERRIDE_BANDS)[number];

/**
 * What each band reads before its own overrides, nearest last.
 *
 * TILE follows SQUARE because the two wear the same arrangement — copy
 * stacked over artwork — so a shop that tuned the square band for its bento
 * cells keeps exactly what it had. What tile does not share is the size it
 * is authored at: its lengths are stated against a 640px frame, not a 390px
 * one, so a half-width desktop cell can carry desktop-sized type without
 * touching the phone.
 */
export const SLIDE_BAND_CHAIN: Record<SlideShape, readonly SlideShape[]> = {
  landscape: ["landscape"],
  tile: ["landscape", "square", "tile"],
  square: ["landscape", "square"],
  portrait: ["landscape", "portrait"],
};

/**
 * Where one shape ends and the next begins, as a width/height ratio.
 *
 * LANDSCAPE is every hero a desktop or a tablet shows: 7:4 (1.75) sits just
 * under the 16:9 tablet hero. (An earlier cut at 11:5 put a desktop hero
 * taller than half the screen into the SQUARE band, which is how a headline
 * arranged on the desktop canvas came out four times the size on the shop.)
 * SQUARE is the phone hero (16:10) and every roughly-square tile down to
 * 3:4; PORTRAIT is a tall cell.
 *
 * A ratio alone cannot tell a phone hero from a TALL desktop hero: a fixed-
 * width hero at full height on a 900px screen is 1248×765 — 1.63, the
 * phone's proportions at three times the phone's width, with every bit of
 * the room a landscape arrangement wants. So a frame at least
 * `SLIDE_WIDE_FRAME_MIN_WIDTH` wide is landscape down to 5:4, whatever the
 * cut says. `shapeForFrame` is the whole rule; `shapeForAspect` the ratio
 * part of it.
 */
export const SLIDE_SHAPE_MIN_LANDSCAPE = 7 / 4;
export const SLIDE_SHAPE_MAX_PORTRAIT = 5 / 7;
export const SLIDE_WIDE_FRAME_MIN_WIDTH = 900;
const SLIDE_WIDE_FRAME_MIN_RATIO = 5 / 4;

/**
 * A square-ish frame this wide is a TILE, not a phone.
 *
 * The same roughly-square proportions arrive at two sizes with nothing in
 * common: a 639x450 half-width cell on a desktop bento, and a 358x224 hero
 * on a phone. One band covered both, so a headline sized for the desktop
 * cell was the same number of pixels on the phone, and a merchant could only
 * ever get one of the two right. 560px is the cut: above it sit the desktop
 * and tablet cells (610-640 wide in every grid the shop ships), below it the
 * phone hero and the narrow masonry cell (358-390).
 */
export const SLIDE_TILE_MIN_WIDTH = 560;

/**
 * The container queries the stylesheet selects the bands with — stated
 * here so a test can pin globals.css to the contract's own numbers. Square
 * is what is left, so it needs no query.
 */
export const SLIDE_BAND_QUERIES = {
  // Tile is stated as a RANGE, and the stylesheet places its block before the
  // other two: CSS has no strict ratio comparison, so a frame sitting exactly
  // on 7/4 or 5/7 matches tile as well, and the later block is the one that
  // wins — which is the answer `shapeForFrame` gives too.
  tile: `@container slide ((min-width: ${SLIDE_TILE_MIN_WIDTH}px) and (min-aspect-ratio: 5/7) and (max-aspect-ratio: 7/4))`,
  landscape: `@container slide ((min-aspect-ratio: 7/4) or ((min-width: ${SLIDE_WIDE_FRAME_MIN_WIDTH}px) and (min-aspect-ratio: 5/4)))`,
  portrait: "@container slide (max-aspect-ratio: 5/7)",
} as const;

/**
 * Which arrangement a container of this ratio wears, KNOWING NOTHING OF ITS
 * SIZE — so it can never answer `tile`, which is a size as much as a shape.
 * Anything holding a frame wants `shapeForFrame`.
 */
export function shapeForAspect(ratio: number): SlideShape {
  if (!Number.isFinite(ratio) || ratio <= 0) return "landscape";
  if (ratio >= SLIDE_SHAPE_MIN_LANDSCAPE) return "landscape";
  if (ratio <= SLIDE_SHAPE_MAX_PORTRAIT) return "portrait";
  return "square";
}

/** Which arrangement a frame of this size wears — the rule the stylesheet applies. */
export function shapeForFrame(width: number, height: number): SlideShape {
  if (!(width > 0) || !(height > 0)) return "landscape";
  const ratio = width / height;
  if (width >= SLIDE_WIDE_FRAME_MIN_WIDTH && ratio >= SLIDE_WIDE_FRAME_MIN_RATIO) {
    return "landscape";
  }
  const shape = shapeForAspect(ratio);
  return shape === "square" && width >= SLIDE_TILE_MIN_WIDTH ? "tile" : shape;
}

/**
 * The frames a hero slider actually gets on the storefront, at its default
 * Width/Height (fixed width, half height) — measured on a 1440×900 desktop,
 * a 768-wide tablet and a 390-wide phone. Desktop: the 1280px container less
 * its 16px sides, by 50svh. Tablet: the container less its sides, at the
 * cell's 16:9. Phone: the same at the cell's 16:10. (The cell ratios are the
 * `.hs-grid--single` rules in globals.css; the heights are slideshow.tsx's.)
 */
export const HERO_FRAMES = {
  desktop: { width: 1248, height: 450 },
  tablet: { width: 736, height: 414 },
  phone: { width: 358, height: 224 },
} as const;

/**
 * THE FRAME each band is authored in — the editor's artboard, drawn at
 * exactly this size (zoomed to fit, never re-proportioned), and the width
 * every length in that band is stated at.
 *
 * Each is a real storefront frame, so what the artboard shows is what a
 * shopper sees: LANDSCAPE is the desktop hero (the 1280px container less its
 * sides, at half the screen), SQUARE is the phone hero (a 390-wide phone,
 * edge to edge, at the cell's 16:10), PORTRAIT a tall 9:16 cell at phone
 * width. Every band's cut is placed so each frame falls in the band it
 * previews.
 */
export const SLIDE_FRAMES: Record<SlideShape, { width: number; height: number }> = {
  landscape: { width: HERO_FRAMES.desktop.width, height: HERO_FRAMES.desktop.height },
  // The half-width desktop cell, to the pixel: `leftCategoryBar3`'s stage
  // (639x450) and `bento4`'s wide cell (610x450) both land on this.
  tile: { width: 640, height: 450 },
  square: { width: 390, height: 244 },
  portrait: { width: 390, height: 693 },
};

/** Elements the toolbar can toggle on a slide. */

export type SlideElement =
  | "heading"
  | "description"
  | "tagline"
  | "price"
  | "cta"
  | "cta2"
  | "countdown";

/** Every element, in the order a new slide stacks them. */
export const SLIDE_ELEMENTS: readonly SlideElement[] = [
  "tagline",
  "heading",
  "description",
  "price",
  "countdown",
  "cta",
  "cta2",
];

/** Elements that carry editable text (and therefore per-text styling). */
const SLIDE_TEXT_ELEMENTS = [
  "tagline",
  "heading",
  "description",
  "cta",
  "cta2",
] as const;
export type SlideTextElement = (typeof SLIDE_TEXT_ELEMENTS)[number];
/** The two buttons; each has its own link and plate style. */
export type SlideCtaElement = "cta" | "cta2";

const TEXT_LIMITS: Record<SlideTextElement, number> = {
  tagline: 200,
  heading: 300,
  description: 600,
  cta: 80,
  cta2: 80,
};

export const SLIDE_FONT_WEIGHTS = [
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
] as const;
export type SlideFontWeight = (typeof SLIDE_FONT_WEIGHTS)[number];

export const SLIDE_TEXT_TRANSFORMS = ["none", "uppercase", "capitalize"] as const;
export type SlideTextTransform = (typeof SLIDE_TEXT_TRANSFORMS)[number];

/**
 * How a highlighted word — one wrapped in *asterisks* in the text — is set
 * apart: in a colour (the theme's primary unless one is picked), in italic,
 * underlined, or on a marker-pen band.
 */
export const SLIDE_HIGHLIGHT_STYLES = ["color", "italic", "underline", "marker"] as const;
export type SlideHighlightStyle = (typeof SLIDE_HIGHLIGHT_STYLES)[number];

/** One run of a text: highlighted or not. */
interface TextSegment {
  text: string;
  highlight: boolean;
}

const HIGHLIGHT = /\*([^*\n]+)\*/g;

/**
 * A text split into its runs: `Early *Access*` is two, the second
 * highlighted. An asterisk with no partner on the same line stays a literal
 * asterisk — nobody loses a footnote mark to a highlight.
 */
export function parseHighlights(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let at = 0;
  for (const match of text.matchAll(HIGHLIGHT)) {
    const start = match.index ?? 0;
    if (start > at) segments.push({ text: text.slice(at, start), highlight: false });
    segments.push({ text: match[1], highlight: true });
    at = start + match[0].length;
  }
  if (at < text.length) segments.push({ text: text.slice(at), highlight: false });
  return segments;
}

/** The text with its highlight marks removed — for alt text, thumbnails, mail. */
export function stripHighlights(text: string): string {
  return text.replace(HIGHLIGHT, "$1");
}

export interface SlideTextStyle {
  weight?: SlideFontWeight;
  style?: "normal" | "italic";
  /** Size in px, exact at the band's frame width (see `slideLength`). */
  size?: number;
  color?: string;
  /**
   * Text BOX width, as a percent of the slide. Every text box has a definite
   * width (this, or the element's default) — which is also what keeps the
   * editor's style/AI buttons anchored: they ride the box's top-right corner,
   * so a box that shrink-wrapped its text would move them on every keystroke.
   */
  width?: number;
  /** Tracking as a percent of the font size (20 = 0.2em); unset follows the element's default. */
  letterSpacing?: number;
  /** Line height as a percent (120 = 1.2). */
  lineHeight?: number;
  /** Case; unset follows the element's default (the tagline is upper-case, a heading follows the theme). */
  transform?: SlideTextTransform;
  /**
   * CTA only: the button's padding in px. Unset = the em-based default that
   * scales with the label.
   */
  paddingX?: number;
  paddingY?: number;
  /** CTA only: a fixed button height in px; unset = as tall as its padding. */
  height?: number;
  /** CTA only: corner radius in px; unset inherits the theme's button radius. */
  radius?: number;
  /** CTA only: the outline's stroke, 1–4px. */
  borderWidth?: number;
  /** CTA only: the plate colour of the "custom" style. */
  fill?: string;
  /** How a *highlighted* word is set apart; absent means no highlight styling. */
  highlight?: { style: SlideHighlightStyle; color?: string };
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
  /**
   * The copy's inset from the slide's edge, px at the band's frame. Unset
   * takes the band's own default (`SLIDE_COPY_PADDING`) — and, unlike every
   * other layout value, a band never inherits another's: an inset that
   * suits a 1248px hero is a third of a phone.
   */
  padding?: number;
}

/** A band's layout with every default filled in — what a surface renders. */
type ResolvedSlideLayout = Required<SlideLayout>;

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
export const SLIDE_CTA_VARIANTS = ["dark", "light", "outline", "custom"] as const;
export type SlideCtaVariant = (typeof SLIDE_CTA_VARIANTS)[number];

/** The plate a "custom" button paints when no fill has been picked yet. */
export const DEFAULT_CTA_FILL = "#1f2937";

/**
 * The chrome each variant renders — shared by the storefront button and the
 * editor canvas so the preview cannot drift. The outline border follows
 * `currentColor`, so recoloring the label recolors the ring with it; a
 * custom plate picks the ink that reads on it, unless a colour is set.
 */
export function ctaVariantChrome(
  variant: SlideCtaVariant,
  style: Pick<SlideTextStyle, "fill" | "borderWidth"> = {},
): {
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
        border: `${style.borderWidth ?? 1}px solid currentColor`,
        textColor: "#1f2937",
      };
    case "custom": {
      const fill = style.fill ?? DEFAULT_CTA_FILL;
      return {
        background: fill,
        border: "none",
        textColor: readableForegroundColor(fill),
      };
    }
    default:
      return { background: "#1f2937", border: "none", textColor: "#ffffff" };
  }
}

export const SLIDE_REVEALS = [
  "none",
  "fade",
  "rise",
  "drop",
  "slide-right",
  "slide-left",
  "zoom",
  "zoom-out",
  "blur",
  "flip",
  "wipe",
  "pop",
  "rotate",
] as const;
type SlideReveal = (typeof SLIDE_REVEALS)[number];

/** The curve a reveal moves on. "spring" overshoots a little and settles. */
export const SLIDE_REVEAL_EASINGS = ["ease", "ease-out", "spring", "linear"] as const;
export type SlideRevealEasing = (typeof SLIDE_REVEAL_EASINGS)[number];
export const REVEAL_EASING_CSS: Record<SlideRevealEasing, string> = {
  ease: "ease",
  "ease-out": "cubic-bezier(0.2, 0.7, 0.2, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  linear: "linear",
};

export const SLIDER_TRANSITIONS = ["slide", "fade"] as const;
export type SliderTransition = (typeof SLIDER_TRANSITIONS)[number];



export interface SliderSlide {
  id: string;
  visible: boolean;
  /** Which elements render (the landscape band). Text values survive a toggle-off. */
  elements: Record<SlideElement, boolean>;
  /**
   * Per-band overrides of which elements show — a phone usually loses the
   * description. Only what a band CHANGES is stored; the rest follows
   * `elements`. Resolve with `resolveSlideElements`.
   */
  elementsByShape?: Partial<
    Record<SlideOverrideBand, Partial<Record<SlideElement, boolean>>>
  >;
  /** The stacking order of the elements; every element appears exactly once. */
  order: SlideElement[];
  texts: {
    tagline: string;
    heading: string;
    description: string;
    cta: string;
    cta2: string;
  };
  /**
   * The copy in other store languages, keyed by locale: only the texts a
   * locale states, the rest falling back to `texts` (the default language).
   */
  translations?: Record<string, Partial<Record<SlideTextElement, string>>>;
  /** The CTA button's chrome: dark plate, light plate, outlined, or a custom fill. */
  ctaVariant: SlideCtaVariant;
  /** The second button's chrome. */
  cta2Variant: SlideCtaVariant;
  /**
   * Type styling, per shape and per property. A headline that carries a wide
   * cell at 42px is unreadable crammed into a tall one, so size — and weight,
   * slant, colour, box width with it — is something each band states for
   * itself. Square and portrait hold only what they CHANGE: every property
   * falls through to landscape on its own, so overriding the size in portrait
   * keeps the weight and colour you set once.
   */
  styles: { landscape: SlideStyleMap } & Partial<Record<SlideOverrideBand, SlideStyleMap>>;
  /** Explicit link; a bound product supplies the fallback destination. */
  link: string;
  /** The second button's link; nothing falls back to it. */
  link2: string;
  /** Product binding — the ONLY source of the Price element. */
  productId: string;
  /** Artwork placed beside the text content (the design's product cutout). */
  productImage: string;
  /**
   * The artwork ON TOP of the copy: the editorial look where the headline
   * runs behind the cutout's edge. Off, the copy is on top, as it was.
   */
  artInFront: boolean;
  countdownEndsAt: string;
  reveal: SlideReveal;
  /** How long the reveal takes, ms. */
  revealDuration?: number;
  /** Elements arrive one after another, this many ms apart; 0 = together. */
  revealStagger?: number;
  /** The curve the reveal moves on; absent = ease. */
  revealEasing?: SlideRevealEasing;
  background: SlideBackground;
  /**
   * Art direction: a band's own background, where the landscape picture
   * would crop badly or a different shot suits a phone. Resolve with
   * `resolveSlideBackground`; a band without one shows the landscape's.
   */
  backgrounds?: Partial<Record<SlideOverrideBand, SlideBackground>>;
  /** The same for the artwork: a band's own cutout. */
  productImages?: Partial<Record<SlideOverrideBand, string>>;
  /** A plate behind the copy column, for legibility over a busy picture. */
  plate?: SlidePlate;
  /** When the slide shows; outside the window it is skipped like a hidden one. */
  schedule?: SlideSchedule;
  layout: { landscape: SlideLayout } & Partial<Record<SlideOverrideBand, Partial<SlideLayout>>>;
  /** The artwork layer's own placement, same per-device fallthrough. */
  image: { landscape: SlideImageLayout } & Partial<
    Record<SlideOverrideBand, Partial<SlideImageLayout>>
  >;
  alt: string;
}

/**
 * The plate behind the copy: a colour (an eight-digit hex carries its
 * transparency), an inset around the text, corners, and a blur of whatever
 * is behind it. The inset is px at the band's frame like every other length.
 */
export interface SlidePlate {
  color: string;
  padding: number;
  radius: number;
  blur: number;
}
export const DEFAULT_REVEAL_DURATION = 600;

export const DEFAULT_SLIDE_PLATE: SlidePlate = {
  color: "#00000059",
  padding: 24,
  radius: 12,
  blur: 8,
};

export interface SlideSchedule {
  /** ISO instant the slide starts showing; absent means already. */
  start?: string;
  /** ISO instant it stops; absent means never. */
  end?: string;
}

/** Whether a slide's window includes `now`. No schedule means always. */
export function slideIsLive(slide: Pick<SliderSlide, "schedule">, now: Date): boolean {
  const { schedule } = slide;
  if (!schedule) return true;
  const at = now.getTime();
  if (schedule.start && at < Date.parse(schedule.start)) return false;
  if (schedule.end && at >= Date.parse(schedule.end)) return false;
  return true;
}

/**
 * The carousel's chrome around the slides — arrows, indicators, the pause
 * control. Slider-level, because they belong to the carousel, not a slide.
 */
export const SLIDER_ARROW_STYLES = ["none", "round", "square", "minimal"] as const;
export const SLIDER_ARROW_POSITIONS = ["sides", "bottom"] as const;
export const SLIDER_DOT_STYLES = ["dots", "bars", "numbers", "none"] as const;
export const SLIDER_DOT_POSITIONS = ["start", "center", "end"] as const;
export interface SliderControls {
  arrows: (typeof SLIDER_ARROW_STYLES)[number];
  arrowsPosition: (typeof SLIDER_ARROW_POSITIONS)[number];
  dots: (typeof SLIDER_DOT_STYLES)[number];
  dotsPosition: (typeof SLIDER_DOT_POSITIONS)[number];
  /** A pause/play control for the autoplay — what moving content owes a reader. */
  pause: boolean;
}
export const DEFAULT_SLIDER_CONTROLS: SliderControls = {
  arrows: "none",
  arrowsPosition: "sides",
  dots: "dots",
  dotsPosition: "end",
  pause: true,
};

/** What a publish captures — everything but the name and the handle. */
export interface SliderContent {
  transition: SliderTransition;
  autoplaySeconds: number;
  controls: SliderControls;
  slides: SliderSlide[];
}

/** A published version, kept so it can be restored. */
export interface SliderHistoryEntry extends SliderContent {
  publishedAt: string;
}
export const MAX_SLIDER_HISTORY = 10;

/**
 * Bumped when what a stored number MEANS changes. 1: lengths were shares of
 * the band's editor canvas (983 / 430 / 242 wide). 2: lengths are px on the
 * band's frame (`SLIDE_FRAMES`). A document below the current version is
 * migrated on read (`normalizeSliderDocument`) and written back at the
 * current one.
 */
export const SLIDER_DOCUMENT_VERSION = 2;

/**
 * A Slider document, as stored (`sliders` collection) and as the API ships it.
 *
 * The top-level content is what is PUBLISHED — what the storefront renders.
 * `draft` holds unpublished work, when there is any: the editor works on it,
 * and Publish copies it here, pushing what was live onto `history`.
 */
export interface SliderDocument extends SliderContent {
  _id?: string;
  /** The contract the document was written against; see `SLIDER_DOCUMENT_VERSION`. */
  version?: number;
  name: string;
  handle: string;
  isActive: boolean;
  draft?: SliderContent & { updatedAt?: string };
  history?: SliderHistoryEntry[];
  /** When the live content last went live; what a history entry is stamped with when it is replaced. */
  publishedAt?: string;
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
 * The Tailwind aspect each band's frame has — `SLIDE_FRAMES` as classes,
 * spelled out because Tailwind only generates a class it can read in the
 * source. The collapsed card on the Sliders page frames a slider at the
 * landscape one; the editor sizes its artboard from `SLIDE_FRAMES` itself.
 */
export const SLIDE_SHAPE_ASPECT_CLASS: Record<SlideShape, string> = {
  landscape: "aspect-[1248/450]",
  tile: "aspect-[640/450]",
  square: "aspect-[390/244]",
  portrait: "aspect-[390/693]",
};

/** The width each band's lengths are stated at: its frame's. */
export const SLIDE_SHAPE_REFERENCE_WIDTH: Record<SlideShape, number> = {
  landscape: SLIDE_FRAMES.landscape.width,
  tile: SLIDE_FRAMES.tile.width,
  square: SLIDE_FRAMES.square.width,
  portrait: SLIDE_FRAMES.portrait.width,
};

/**
 * The editor never draws an artboard taller than this on screen; a frame
 * that would be is zoomed out instead, so the tall band still fits a laptop
 * without scrolling the toolbar away.
 */
export const EDITOR_CANVAS_MAX_HEIGHT = 560;

/**
 * How a typed length behaves away from its band's frame.
 *
 * AT OR ABOVE the frame's width the number is exact: 24px typed is 24px on a
 * desktop hero however wide the window, which is what makes the artboard
 * honest — and what makes the editor, the builder's block preview and the
 * shop agree to the pixel. BELOW it the length eases down with the width,
 * but only towards half its size at nothing, so a slide dropped in a small
 * tile shrinks with it without shouting or vanishing. (An earlier build
 * scaled every length in pure proportion to the width, against a reference
 * that differed per band; a hero that crossed a band's cut jumped to four
 * times the size.)
 *
 * Text eases only the part ABOVE `FLUID_TEXT_BASE_PX`: small type — a button
 * label, a tagline — holds nearly all of its size while a display headline
 * gives up the most, which is how a designer sizes a phone by hand.
 */
export const FLUID_MIN_SHARE = 0.5;
export const FLUID_TEXT_BASE_PX = 12;

function round(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * A typed px length as CSS: exact at the band's frame width, easing below
 * it. `base` is the part that never eases (text passes `FLUID_TEXT_BASE_PX`;
 * a gap or an inset passes nothing).
 */
export function slideLength(px: number, shape: SlideShape, base = 0): string {
  if (!(px > 0)) return "0px";
  const eased = Math.max(0, px - base);
  if (eased === 0) return `${round(px)}px`;
  const held = px - eased + eased * FLUID_MIN_SHARE;
  // The share is rounded UP: rounded down, the sum falls a few thousandths
  // short of the number at the frame's exact width, and the cap never
  // takes — the artboard then drew 46.9995px where the shop drew 47.
  const share =
    Math.ceil(
      ((eased * (1 - FLUID_MIN_SHARE)) / SLIDE_SHAPE_REFERENCE_WIDTH[shape]) *
        100 *
        10000,
    ) / 10000;
  return `min(${round(px)}px, calc(${round(held)}px + ${share}cqw))`;
}

/** Type never shrinks below this, however small the cell gets. */
export const MIN_TEXT_PX = 9;

/**
 * A text's rendered size for one band. A size is always read against the
 * band it renders in — inherited or not — so the number in the style panel
 * is the number of pixels on that band's artboard. BOTH surfaces must go
 * through this (they do, through `textStyleVars`); the editor once computed
 * the same thing inline and drifted from the storefront by a factor of two.
 */
export function textSizeCss(
  slide: SliderSlide,
  element: SlideTextElement,
  shape: SlideShape,
): string {
  return slideLength(
    resolveTextStyle(slide, element, shape).size,
    shape,
    FLUID_TEXT_BASE_PX,
  );
}

/**
 * A size no band can override (the price line). It still has to follow the
 * slide, so it is stated per band like everything else.
 */
export function fixedSizeVars(px: number): Record<string, string> {
  return Object.fromEntries(
    SLIDE_BAND_KEYS.map(([suffix, shape]) => [
      `--fs-${suffix}`,
      slideLength(px, shape, FLUID_TEXT_BASE_PX),
    ]),
  );
}

/**
 * Inset of each layer from the slide's edge, per band, in px at the band's
 * frame. The copy's is the default a slide's `layout.padding` overrides; the
 * artwork's is fixed. Both reach the stylesheet as custom properties
 * (`--sl-pad`, `--sl-art-pad`), so the CSS never states a number of its own
 * and the two surfaces cannot disagree about it.
 */
export const SLIDE_COPY_PADDING: Record<SlideShape, number> = {
  portrait: 24,
  square: 24,
  // A tile has half a hero's width and all of its height: between the two.
  tile: 32,
  landscape: 48,
};
export const MAX_COPY_PADDING = 200;

const SLIDE_ART_PADDING: Record<SlideShape, number> = {
  portrait: 16,
  square: 16,
  tile: 20,
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
  cta2: 14,
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
  cta2: 0,
};

/** Line height as a percent of the size. */
export const DEFAULT_LINE_HEIGHT = 120;

/**
 * Where an element's look comes from when the slide says nothing: a heading
 * and the button follow the THEME's own type tokens (a store whose buttons
 * are upper-case gets upper-case slide buttons), the tagline is the design's
 * spaced capitals, the description is plain. Stated as CSS so the theme is
 * read where it applies — on the surface — rather than guessed here.
 */
const DEFAULT_TEXT_WEIGHT: Record<SlideTextElement, string> = {
  tagline: "400",
  heading: "var(--store-heading-weight, 700)",
  description: "400",
  cta: "var(--store-btn-weight, 500)",
  cta2: "var(--store-btn-weight, 500)",
};
const DEFAULT_LETTER_SPACING: Record<SlideTextElement, string> = {
  tagline: "0.2em",
  heading: "var(--store-heading-tracking, normal)",
  description: "normal",
  cta: "var(--store-btn-tracking, normal)",
  cta2: "var(--store-btn-tracking, normal)",
};
const DEFAULT_TEXT_TRANSFORM: Record<SlideTextElement, string> = {
  tagline: "uppercase",
  heading: "var(--store-heading-transform, none)",
  description: "none",
  cta: "var(--store-btn-transform, none)",
  cta2: "var(--store-btn-transform, none)",
};

/**
 * A copy of a slide, with an id derived from the original rather than from
 * the clock: "hero" copied becomes "hero-copy", then "hero-copy-2". Pure,
 * so the editor can call it from an event handler and a test can pin it.
 *
 * The copy is DEEP: a slide's layout, styles and texts are nested objects
 * the editor patches in place, and a shallow copy would leave the two
 * slides editing each other.
 */
export function duplicateSlide(
  slide: SliderSlide,
  taken: readonly string[],
): SliderSlide {
  const used = new Set(taken);
  const base = `${slide.id}-copy`;
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  return { ...structuredClone(slide), id };
}

/**
 * One slide's LOOK on every other slide in the group: the per-element type
 * styling (weight, slant, size, colour, box width) and the button's chrome.
 *
 * ALIGNMENT IS DELIBERATELY LEFT ALONE. Where the copy sits is composed
 * against that slide's own artwork — a headline pushed right because the
 * product fills the left of the picture — so carrying it over would break
 * every arrangement the merchant made. Everything in `layout` (alignment, gap,
 * scale) and each slide's artwork placement therefore stays exactly as it was;
 * only the styling travels.
 *
 * Deep-cloned per slide, for the same reason `duplicateSlide` clones: the
 * editor patches styles in place, and a shared object would make one slide's
 * later edit silently rewrite the rest.
 */
export function applySlideStyleToGroup(
  slides: readonly SliderSlide[],
  sourceId: string,
): SliderSlide[] {
  const source = slides.find((slide) => slide.id === sourceId);
  if (!source) return [...slides];
  return slides.map((slide) =>
    slide.id === sourceId
      ? slide
      : {
          ...slide,
          styles: structuredClone(source.styles),
          ctaVariant: source.ctaVariant,
          cta2Variant: source.cta2Variant,
          ...(source.plate
            ? { plate: structuredClone(source.plate) }
            : { plate: undefined }),
        },
  );
}

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
      cta2: false,
      countdown: false,
    },
    order: [...SLIDE_ELEMENTS],
    texts: { tagline: "", heading: "", description: "", cta: "", cta2: "" },
    ctaVariant: "dark",
    cta2Variant: "outline",
    styles: { landscape: {} },
    link: "",
    link2: "",
    productId: "",
    productImage: "",
    artInFront: false,
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
  if (
    typeof source.letterSpacing === "number" &&
    Number.isFinite(source.letterSpacing)
  ) {
    style.letterSpacing = readNumber(source.letterSpacing, 0, -10, 50);
  }
  if (typeof source.lineHeight === "number" && Number.isFinite(source.lineHeight)) {
    style.lineHeight = readNumber(source.lineHeight, DEFAULT_LINE_HEIGHT, 80, 200);
  }
  if (SLIDE_TEXT_TRANSFORMS.includes(source.transform as SlideTextTransform)) {
    style.transform = source.transform as SlideTextTransform;
  }
  if (typeof source.radius === "number" && Number.isFinite(source.radius)) {
    style.radius = readNumber(source.radius, 0, 0, 60);
  }
  if (
    typeof source.borderWidth === "number" &&
    Number.isFinite(source.borderWidth)
  ) {
    style.borderWidth = readNumber(source.borderWidth, 1, 1, 4);
  }
  const fill = color(source.fill);
  if (fill) style.fill = fill;
  const highlight = record(source.highlight);
  if (SLIDE_HIGHLIGHT_STYLES.includes(highlight.style as SlideHighlightStyle)) {
    const highlightColor = color(highlight.color);
    style.highlight = {
      style: highlight.style as SlideHighlightStyle,
      ...(highlightColor ? { color: highlightColor } : {}),
    };
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
  const layout: SlideLayout = {
    h: oneOf(source.h, SLIDE_H_ALIGN, DEFAULT_SLIDE_LAYOUT.h),
    v: oneOf(source.v, SLIDE_V_ALIGN, DEFAULT_SLIDE_LAYOUT.v),
    gap: readNumber(source.gap, DEFAULT_SLIDE_LAYOUT.gap, 0, 60),
    scale: readNumber(source.scale, DEFAULT_SLIDE_LAYOUT.scale, 40, 200),
  };
  if (typeof source.padding === "number" && Number.isFinite(source.padding)) {
    layout.padding = readNumber(source.padding, 0, 0, MAX_COPY_PADDING);
  }
  return layout;
}

/**
 * Documents written against the device model carry desktop/tablet/mobile.
 * The reading is the one a designer would make — a desktop hero is wide, a
 * phone is tall — so the old keys map straight onto the bands and an
 * existing slider keeps its arrangement without anyone re-doing it. Tile
 * post-dates that model and has no old name.
 */
const LEGACY_BAND_KEY: Partial<Record<SlideOverrideBand, string>> = {
  square: "tablet",
  portrait: "mobile",
};

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
  if (typeof source.padding === "number") {
    layout.padding = readNumber(source.padding, 0, 0, MAX_COPY_PADDING);
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



function record(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null
    ? (raw as Record<string, unknown>)
    : {};
}

/** Only the flags a source states, so a band override stays a diff. */
function normalizeElementFlags(raw: unknown): Partial<Record<SlideElement, boolean>> {
  const source = record(raw);
  const flags: Partial<Record<SlideElement, boolean>> = {};
  for (const element of SLIDE_ELEMENTS) {
    if (typeof source[element] === "boolean") flags[element] = source[element] as boolean;
  }
  return flags;
}

/** Every element exactly once: unknown names dropped, missing ones appended. */
function normalizeOrder(raw: unknown): SlideElement[] {
  const order: SlideElement[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (SLIDE_ELEMENTS.includes(entry as SlideElement) && !order.includes(entry as SlideElement)) {
      order.push(entry as SlideElement);
    }
  }
  for (const element of SLIDE_ELEMENTS) {
    if (!order.includes(element)) order.push(element);
  }
  return order;
}

const LOCALE_KEY = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function normalizeTranslations(raw: unknown): SliderSlide["translations"] {
  if (typeof raw !== "object" || raw === null) return undefined;
  const out: NonNullable<SliderSlide["translations"]> = {};
  for (const [locale, value] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    if (!LOCALE_KEY.test(locale)) continue;
    const texts: Partial<Record<SlideTextElement, string>> = {};
    const source = record(value);
    for (const element of SLIDE_TEXT_ELEMENTS) {
      const text = source[element];
      if (typeof text === "string" && text) texts[element] = text.slice(0, TEXT_LIMITS[element]);
    }
    if (Object.keys(texts).length > 0) out[locale] = texts;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizePlate(raw: unknown): SlidePlate | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = record(raw);
  const c = color(source.color);
  if (!c) return undefined;
  return {
    color: c,
    padding: readNumber(source.padding, DEFAULT_SLIDE_PLATE.padding, 0, 120),
    radius: readNumber(source.radius, DEFAULT_SLIDE_PLATE.radius, 0, 80),
    blur: readNumber(source.blur, DEFAULT_SLIDE_PLATE.blur, 0, 40),
  };
}

function isoDate(value: unknown): string | undefined {
  return typeof value === "string" && value && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

function normalizeSchedule(raw: unknown): SlideSchedule | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = record(raw);
  const schedule: SlideSchedule = {};
  const start = isoDate(source.start);
  if (start) schedule.start = start;
  const end = isoDate(source.end);
  if (end) schedule.end = end;
  return schedule.start || schedule.end ? schedule : undefined;
}

function normalizeSlide(raw: unknown, index: number): SliderSlide {
  const source = record(raw);
  const elementsSource = record(source.elements);
  const textsSource = record(source.texts);
  const stylesSource = record(source.styles);
  const layoutSource = record(source.layout);
  const imageSource = record(source.image);

  // Styling used to be one flat map shared by every shape. A document in that
  // shape has text-element keys at the top level and no band keys, so the old
  // map simply becomes the landscape band — which is the one it was authored
  // against — and the other two start empty, inheriting all of it.
  const legacyFlat = !SLIDE_SHAPES.some(
    (shape) => typeof stylesSource[shape] === "object",
  );
  const styleMapAt = (raw: unknown): SlideStyleMap => {
    const source = record(raw);
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
    for (const shape of SLIDE_OVERRIDE_BANDS) {
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
      cta2: readBoolean(elementsSource.cta2, false),
      countdown: readBoolean(elementsSource.countdown, false),
    },
    order: normalizeOrder(source.order),
    texts: {
      tagline: str(textsSource.tagline, TEXT_LIMITS.tagline),
      heading: str(textsSource.heading, TEXT_LIMITS.heading),
      description: str(textsSource.description, TEXT_LIMITS.description),
      cta: str(textsSource.cta, TEXT_LIMITS.cta),
      cta2: str(textsSource.cta2, TEXT_LIMITS.cta2),
    },
    // Documents older than the variant rendered a white button over image
    // backgrounds and a dark one otherwise — the default preserves exactly
    // that reading, so no existing slider changes look.
    ctaVariant: oneOf(
      source.ctaVariant,
      SLIDE_CTA_VARIANTS,
      background.type === "image" ? "light" : "dark",
    ),
    cta2Variant: oneOf(source.cta2Variant, SLIDE_CTA_VARIANTS, "outline"),
    styles,
    link: str(source.link, 600),
    link2: str(source.link2, 600),
    productId: str(source.productId, 64),
    productImage: str(source.productImage, 1000),
    artInFront: readBoolean(source.artInFront, false),
    countdownEndsAt: isoDate(source.countdownEndsAt) ?? "",
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
  const byShape = record(source.elementsByShape);
  for (const shape of SLIDE_OVERRIDE_BANDS) {
    const flags = normalizeElementFlags(byShape[shape]);
    if (Object.keys(flags).length > 0) {
      slide.elementsByShape = { ...(slide.elementsByShape ?? {}), [shape]: flags };
    }
  }
  const translations = normalizeTranslations(source.translations);
  if (translations) slide.translations = translations;
  const plate = normalizePlate(source.plate);
  if (plate) slide.plate = plate;
  const backgrounds = record(source.backgrounds);
  for (const shape of SLIDE_OVERRIDE_BANDS) {
    if (typeof backgrounds[shape] !== "object" || backgrounds[shape] === null) continue;
    const own = normalizeBackground(backgrounds[shape]);
    if (!hasBackground(own)) continue;
    slide.backgrounds = { ...(slide.backgrounds ?? {}), [shape]: own };
  }
  const productImages = record(source.productImages);
  for (const shape of SLIDE_OVERRIDE_BANDS) {
    const image = str(productImages[shape], 1000);
    if (image) slide.productImages = { ...(slide.productImages ?? {}), [shape]: image };
  }
  if (typeof source.revealDuration === "number" && Number.isFinite(source.revealDuration)) {
    slide.revealDuration = readNumber(source.revealDuration, DEFAULT_REVEAL_DURATION, 200, 2000);
  }
  if (typeof source.revealStagger === "number" && Number.isFinite(source.revealStagger) && source.revealStagger > 0) {
    slide.revealStagger = readNumber(source.revealStagger, 0, 0, 400);
  }
  if (
    SLIDE_REVEAL_EASINGS.includes(source.revealEasing as SlideRevealEasing) &&
    source.revealEasing !== "ease"
  ) {
    slide.revealEasing = source.revealEasing as SlideRevealEasing;
  }
  const schedule = normalizeSchedule(source.schedule);
  if (schedule) slide.schedule = schedule;
  // Every band that can override, read the same way. Spelling two of them
  // out here is how a band added to the contract was silently dropped on
  // every write: the editor showed the change, Publish round-tripped it
  // through this function, and the override was simply not carried across.
  for (const band of SLIDE_OVERRIDE_BANDS) {
    const legacy = LEGACY_BAND_KEY[band];
    const own = normalizePartialLayout(
      layoutSource[band] ?? (legacy ? layoutSource[legacy] : undefined),
    );
    if (own) slide.layout[band] = own;
    const art = normalizePartialImageLayout(
      imageSource[band] ?? (legacy ? imageSource[legacy] : undefined),
    );
    if (art) slide.image[band] = art;
  }
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

/**
 * Every band falls through its chain to landscape for anything unset —
 * except the INSET, which landscape never hands down: a 48px desktop inset
 * would swallow a phone. Each band states its own or takes its default,
 * and tile may take the one square states.
 */
export function resolveSlideLayout(
  slide: SliderSlide,
  shape: SlideShape,
): ResolvedSlideLayout {
  const merged: SlideLayout = { ...slide.layout.landscape };
  let padding = shape === "landscape" ? slide.layout.landscape.padding : undefined;
  for (const band of SLIDE_BAND_CHAIN[shape]) {
    if (band === "landscape") continue;
    const own = slide.layout[band];
    if (!own) continue;
    Object.assign(merged, own);
    if (own.padding !== undefined) padding = own.padding;
  }
  return { ...merged, padding: padding ?? SLIDE_COPY_PADDING[shape] };
}

export function resolveImageLayout(
  slide: SliderSlide,
  shape: SlideShape,
): SlideImageLayout {
  const merged: SlideImageLayout = { ...slide.image.landscape };
  for (const band of SLIDE_BAND_CHAIN[shape]) {
    if (band === "landscape") continue;
    Object.assign(merged, slide.image[band] ?? {});
  }
  return merged;
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
  const style: SlideTextStyle = { ...slide.styles.landscape[element] };
  for (const band of SLIDE_BAND_CHAIN[shape]) {
    if (band === "landscape") continue;
    Object.assign(style, slide.styles[band]?.[element]);
  }
  return {
    ...style,
    size: style.size ?? DEFAULT_TEXT_SIZES[element],
    width: style.width ?? DEFAULT_TEXT_WIDTHS[element],
  };
}

/** Every band and the suffix its custom properties carry. */
export const SLIDE_BAND_KEYS = [
  ["l", "landscape"],
  ["t", "tile"],
  ["s", "square"],
  ["p", "portrait"],
] as const;

/** Tracking as CSS: the merchant's percent of the size, or the element's default. */
function letterSpacingCss(element: SlideTextElement, value?: number): string {
  return value === undefined
    ? DEFAULT_LETTER_SPACING[element]
    : `${value / 100}em`;
}

/**
 * A highlighted word's look for one band: its colour (the theme's primary
 * unless picked), slant, underline and marker band. Without a highlight
 * style the word simply reads as the text around it.
 */
function highlightVars(
  highlight: SlideTextStyle["highlight"],
  suffix: string,
): Record<string, string> {
  if (!highlight) {
    return {
      [`--hl-${suffix}`]: "inherit",
      [`--hi-${suffix}`]: "inherit",
      [`--hu-${suffix}`]: "none",
      [`--hm-${suffix}`]: "transparent",
    };
  }
  const accent = highlight.color ?? "var(--primary, currentColor)";
  return {
    [`--hl-${suffix}`]: highlight.style === "color" || highlight.color ? accent : "inherit",
    [`--hi-${suffix}`]: highlight.style === "italic" ? "italic" : "inherit",
    [`--hu-${suffix}`]: highlight.style === "underline" ? "underline" : "none",
    [`--hm-${suffix}`]:
      highlight.style === "marker"
        ? `color-mix(in srgb, ${highlight.color ?? "var(--primary, #ffd54f)"} 35%, transparent)`
        : "transparent",
  };
}

/** One band's share of a text's variables (see `textStyleVars`). */
function bandTextVars(
  slide: SliderSlide,
  element: SlideTextElement,
  shape: SlideShape,
  suffix: string,
  fallbackColor: string,
): Record<string, string> {
  const style = resolveTextStyle(slide, element, shape);
  return {
    [`--fs-${suffix}`]: textSizeCss(slide, element, shape),
    [`--wt-${suffix}`]: style.weight ?? DEFAULT_TEXT_WEIGHT[element],
    [`--it-${suffix}`]: style.style ?? "normal",
    [`--co-${suffix}`]: style.color ?? fallbackColor,
    [`--wd-${suffix}`]: textBoxWidthCss(style.width),
    [`--ls-${suffix}`]: letterSpacingCss(element, style.letterSpacing),
    [`--lh-${suffix}`]: String((style.lineHeight ?? DEFAULT_LINE_HEIGHT) / 100),
    [`--tt-${suffix}`]: style.transform ?? DEFAULT_TEXT_TRANSFORM[element],
    ...highlightVars(style.highlight, suffix),
  };
}

/**
 * A text's per-band styling as CSS custom properties, to be set INLINE on the
 * element itself.
 *
 * Declaring them on the element is what keeps the stylesheet small: one
 * generic `.sl-text` rule per band aliases `--fs-l|t|s|p` down to `--fs`, and
 * that same rule then serves every text on every slide — on the storefront
 * AND on the editor's artboard, which is a real `.sl-frame` too. The
 * alternative — naming each element in the CSS — would be twenty
 * declarations per band that have to be kept in step with this file by hand.
 */
export function textStyleVars(
  slide: SliderSlide,
  element: SlideTextElement,
  fallbackColor: string,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [suffix, shape] of SLIDE_BAND_KEYS) {
    Object.assign(vars, bandTextVars(slide, element, shape, suffix, fallbackColor));
  }
  return vars;
}

/**
 * The properties every `.sl-text` reads from the aliases above. The size is
 * the band's fluid length under the band's Scale, with a floor so a slide
 * dropped into a tiny tile never disappears.
 */
export const SLIDE_TEXT_CSS: Record<string, string> = {
  fontSize: `max(${MIN_TEXT_PX}px, calc(var(--fs) * var(--sl-scale, 1)))`,
  fontWeight: "var(--wt)",
  fontStyle: "var(--it)",
  color: "var(--co)",
  lineHeight: "var(--lh)",
  letterSpacing: "var(--ls)",
  textTransform: "var(--tt)",
};

/**
 * Everything one text element wears, inline: its per-band variables, the
 * properties that read them, and its box. The heading also carries the
 * theme's heading face, which the `.store-surface` rule would give an <h2>
 * but not the editor's box — so it is stated here, for both.
 */
export function textStyleCss(
  slide: SliderSlide,
  element: SlideTextElement,
  fallbackColor: string,
): CSSProperties {
  return {
    ...textStyleVars(slide, element, fallbackColor),
    ...SLIDE_TEXT_CSS,
    ...(element === "heading"
      ? { fontFamily: "var(--store-font-heading, inherit)" }
      : {}),
    width: "var(--wd)",
    maxWidth: "100%",
  } as CSSProperties;
}

/** The class every CTA wears on both surfaces; `sl-cta` aliases its box. */
export const SLIDE_CTA_CLASS =
  "sl-text sl-cta inline-flex h-auto max-w-full items-center justify-center whitespace-nowrap transition-opacity hover:opacity-90";

/**
 * The attributes the theme restyles a button by (face, weight, case,
 * tracking, corners). The size is the slide's OWN so the theme's fixed
 * button height stays off it — that fixed height is what made Padding Y do
 * nothing on the shop.
 */
export const SLIDE_CTA_ATTRS = {
  "data-slot": "button",
  "data-size": "slide",
  "data-variant": "default",
} as const;

/**
 * The CTA's per-band variables: its type (as any text), plus its box —
 * padding, height, corners, plate and ring — each read against the band it
 * renders in, so a button padded on the phone artboard is padded on phones.
 */
export function ctaStyleVars(
  slide: SliderSlide,
  element: SlideCtaElement = "cta",
): Record<string, string> {
  const vars: Record<string, string> = {};
  const variant = element === "cta2" ? slide.cta2Variant : slide.ctaVariant;
  for (const [suffix, shape] of SLIDE_BAND_KEYS) {
    const style = resolveTextStyle(slide, element, shape);
    const chrome = ctaVariantChrome(variant, style);
    Object.assign(vars, bandTextVars(slide, element, shape, suffix, chrome.textColor));
    vars[`--px-${suffix}`] =
      style.paddingX !== undefined ? slideLength(style.paddingX, shape) : "1.6em";
    vars[`--py-${suffix}`] =
      style.paddingY !== undefined ? slideLength(style.paddingY, shape) : "0.7em";
    vars[`--mh-${suffix}`] = style.height ? slideLength(style.height, shape) : "0px";
    vars[`--br-${suffix}`] =
      style.radius !== undefined
        ? `${style.radius}px`
        : "var(--store-radius-button, 6px)";
    vars[`--bg-${suffix}`] = chrome.background;
    vars[`--bd-${suffix}`] = chrome.border;
  }
  return vars;
}

/** The properties a `.sl-cta` reads on top of the text ones. */
const SLIDE_CTA_CSS: Record<string, string> = {
  ...SLIDE_TEXT_CSS,
  width: "var(--wd)",
  padding: "var(--py) var(--px)",
  minHeight: "var(--mh)",
  borderRadius: "var(--br)",
  backgroundColor: "var(--bg)",
  border: "var(--bd)",
};

/** Everything a button wears inline, on both surfaces. */
export function ctaStyleCss(
  slide: SliderSlide,
  element: SlideCtaElement = "cta",
): CSSProperties {
  return { ...ctaStyleVars(slide, element), ...SLIDE_CTA_CSS } as CSSProperties;
}

const JUSTIFY: Record<SlideHAlign, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};
const ALIGN: Record<SlideVAlign, string> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

/**
 * The copy layer's per-band placement — alignment, gap, scale, inset — as
 * the custom properties the `.sl-content` / `.sl-stack` rules read.
 */
export function slideLayoutVars(slide: SliderSlide): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [suffix, shape] of SLIDE_BAND_KEYS) {
    const layout = resolveSlideLayout(slide, shape);
    vars[`--sl-jc-${suffix}`] = JUSTIFY[layout.h];
    vars[`--sl-ai-${suffix}`] = ALIGN[layout.v];
    vars[`--sl-ta-${suffix}`] = layout.h;
    vars[`--sl-gap-${suffix}`] = slideLength(layout.gap, shape);
    vars[`--sl-scale-${suffix}`] = `${layout.scale / 100}`;
    vars[`--sl-pad-${suffix}`] = slideLength(layout.padding, shape);
    vars[`--sl-plate-pad-${suffix}`] = slide.plate
      ? slideLength(slide.plate.padding, shape)
      : "0px";
  }
  // The reveal's timing: how long, and how far apart the elements arrive.
  vars["--sl-reveal-ms"] = `${slide.revealDuration ?? DEFAULT_REVEAL_DURATION}ms`;
  vars["--sl-stagger"] = `${slide.revealStagger ?? 0}ms`;
  vars["--sl-reveal-ease"] = REVEAL_EASING_CSS[slide.revealEasing ?? "ease"];
  // The plate's colour, corners and blur are the slide's, not a band's.
  vars["--sl-plate-bg"] = slide.plate?.color ?? "transparent";
  vars["--sl-plate-r"] = `${slide.plate?.radius ?? 0}px`;
  vars["--sl-plate-blur"] = `${slide.plate?.blur ?? 0}px`;
  return vars;
}

/** The nearest band in a chain that states something, nearest first. */
function nearest<T>(shape: SlideShape, at: (band: SlideOverrideBand) => T | undefined): T | undefined {
  const chain = SLIDE_BAND_CHAIN[shape];
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const band = chain[i];
    if (band === "landscape") break;
    const own = at(band);
    if (own) return own;
  }
  return undefined;
}

/** The background a band shows: its own, its chain's, or the landscape's. */
export function resolveSlideBackground(slide: SliderSlide, shape: SlideShape): SlideBackground {
  return nearest(shape, (band) => slide.backgrounds?.[band]) ?? slide.background;
}

/** The artwork a band shows: its own cutout, its chain's, or the landscape's. */
export function resolveSlideArt(slide: SliderSlide, shape: SlideShape): string {
  return nearest(shape, (band) => slide.productImages?.[band]) ?? slide.productImage;
}

/** Whether any band has a picture or a cutout of its own. */
export function slideHasArtDirection(slide: SliderSlide): boolean {
  return SLIDE_OVERRIDE_BANDS.some(
    (band) => slide.backgrounds?.[band] || slide.productImages?.[band],
  );
}

/**
 * The URL the browser should fetch for a picture at a width: the app's own
 * optimiser for a local path or a trusted host (WebP, the right size), the
 * picture itself for anything else. What `next/image` would produce, for
 * the places that paint a picture through CSS rather than an <img>.
 */
export function optimizedImageUrl(src: string, width: number): string {
  const trimmed = src.trim();
  if (!trimmed) return trimmed;
  if (/^(data:|blob:)/i.test(trimmed) || /\.svgz?(?:[?#]|$)/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed) && !isTrustedRemoteUrl(trimmed)) return trimmed;
  return `/_next/image?url=${encodeURIComponent(trimmed)}&w=${width}&q=80`;
}

/** The width the optimiser is asked for per band: the frame, at 2× for sharp screens, capped. */
const BAND_IMAGE_WIDTH: Record<SlideShape, number> = {
  landscape: 1920,
  tile: 1280,
  square: 828,
  portrait: 828,
};

/**
 * An art-directed background as custom properties: per band, the picture
 * (as a CSS image, so only the band's own is ever fetched), where it is
 * focused, and its blur. Read by the `.sl-bg--band` rules.
 */
export function slideBackgroundVars(slide: SliderSlide): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [suffix, shape] of SLIDE_BAND_KEYS) {
    const background = resolveSlideBackground(slide, shape);
    const picture = background.type === "image" || background.type === "video" ? background.image : undefined;
    vars[`--sl-bgi-${suffix}`] = picture
      ? `url("${optimizedImageUrl(picture, BAND_IMAGE_WIDTH[shape]).replace(/["\\]/g, "")}")`
      : "none";
    vars[`--sl-bgp-${suffix}`] = focalPositionCss(background);
    vars[`--sl-bgf-${suffix}`] = backgroundFilterCss(background);
    vars[`--sl-bgc-${suffix}`] =
      background.type === "solid" && background.color
        ? background.color
        : background.type === "gradient" && background.gradient
          ? "transparent"
          : "transparent";
    vars[`--sl-bgg-${suffix}`] =
      background.type === "gradient" && background.gradient
        ? buildGradientCss(background.gradient)
        : "none";
  }
  return vars;
}

/**
 * Which elements a band shows: the landscape flags, with the band's own
 * overrides on top. Text values are untouched by any of it.
 */
export function resolveSlideElements(
  slide: SliderSlide,
  shape: SlideShape,
): Record<SlideElement, boolean> {
  if (shape === "landscape") return slide.elements;
  const flags = { ...slide.elements };
  for (const band of SLIDE_BAND_CHAIN[shape]) {
    if (band === "landscape") continue;
    Object.assign(flags, slide.elementsByShape?.[band] ?? {});
  }
  return flags;
}

/** The artwork layer's per-band placement, the same way. */
export function slideArtVars(slide: SliderSlide): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [suffix, shape] of SLIDE_BAND_KEYS) {
    const { container, art } = imageLayerStyle(resolveImageLayout(slide, shape));
    vars[`--sl-art-jc-${suffix}`] = container.justifyContent;
    vars[`--sl-art-ai-${suffix}`] = container.alignItems;
    vars[`--sl-art-w-${suffix}`] = art.width;
    vars[`--sl-art-t-${suffix}`] = art.transform;
    vars[`--sl-art-pad-${suffix}`] = slideLength(SLIDE_ART_PADDING[shape], shape);
  }
  return vars;
}

/** The price line's own size, in the same width-relative terms. */
export const SLIDE_PRICE_PX = 26;

/**
 * A text box's width as CSS: its share of the PADDED SLIDE, computed from
 * the frame rather than taken as a percent of the column. The column hugs
 * its content (so a plate behind it hugs the copy), and a percent of a
 * hugging column would be a percent of whatever the longest line happened
 * to be — the drift the storefront and the editor once had.
 */
export function textBoxWidthCss(width: number): string {
  return width > 0
    ? `calc(${width / 100} * (100cqw - 2 * var(--sl-pad, 0px)))`
    : "auto";
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

/* ------------------------------------------------------------------ */
/* The document: controls, versions and migration.                    */
/* ------------------------------------------------------------------ */

export function normalizeSliderControls(raw: unknown): SliderControls {
  const source = record(raw);
  return {
    arrows: oneOf(source.arrows, SLIDER_ARROW_STYLES, DEFAULT_SLIDER_CONTROLS.arrows),
    arrowsPosition: oneOf(
      source.arrowsPosition,
      SLIDER_ARROW_POSITIONS,
      DEFAULT_SLIDER_CONTROLS.arrowsPosition,
    ),
    dots: oneOf(source.dots, SLIDER_DOT_STYLES, DEFAULT_SLIDER_CONTROLS.dots),
    dotsPosition: oneOf(
      source.dotsPosition,
      SLIDER_DOT_POSITIONS,
      DEFAULT_SLIDER_CONTROLS.dotsPosition,
    ),
    pause: readBoolean(source.pause, DEFAULT_SLIDER_CONTROLS.pause),
  };
}

/** The width each band's lengths were stated at before version 2. */
const V1_REFERENCE_WIDTH: Record<SlideShape, number> = {
  landscape: 983,
  // Tile did not exist in version 1: a frame that is a tile now rendered
  // under the SQUARE rules then, against the square reference. Baking that
  // reference keeps a migrated slider drawing the same pixels on the cells
  // that have just changed band.
  tile: 430,
  square: 430,
  portrait: 242,
};

/**
 * Version 1 → 2: every length becomes the px it RENDERED at on the band's
 * frame, so a slider looks on each frame exactly as it did.
 *
 * In version 1 a size was a share of the band's old reference width; on the
 * desktop hero a stored 40 drew at 40 × 1248 / 983 ≈ 51px. Now a stored
 * number is exact on the frame, so the same slider needs 51 stored to draw
 * the same. Each band is baked explicitly — inherited or not — because the
 * inherited share differed per band (that was the point of the references)
 * and the phone's must stay the phone's, not follow the desktop's new
 * number. Button padding was already literal px and is left alone.
 */
export function migrateSlidesV1(slides: SliderSlide[]): SliderSlide[] {
  const factor = (shape: SlideShape) =>
    SLIDE_FRAMES[shape].width / V1_REFERENCE_WIDTH[shape];
  return slides.map((slide) => {
    const styles: SliderSlide["styles"] = { landscape: {} };
    for (const shape of SLIDE_SHAPES) {
      const map: SlideStyleMap = {};
      for (const element of SLIDE_TEXT_ELEMENTS) {
        if (element === "cta2") continue; // did not exist
        const rendered = resolveTextStyle(slide, element, shape).size;
        map[element] = {
          ...ownTextStyle(slide, element, shape),
          size: Math.min(120, Math.max(8, Math.round(rendered * factor(shape)))),
        };
      }
      if (shape === "landscape") styles.landscape = map;
      else styles[shape] = map;
    }
    const layout: SliderSlide["layout"] = { ...slide.layout };
    for (const shape of SLIDE_SHAPES) {
      const gap = Math.min(60, Math.round(resolveSlideLayout(slide, shape).gap * factor(shape)));
      if (shape === "landscape") layout.landscape = { ...layout.landscape, gap };
      else layout[shape] = { ...(layout[shape] ?? {}), gap };
    }
    return { ...slide, styles, layout };
  });
}

/**
 * A stored slider read for use: every part normalized, a pre-version-2
 * document's numbers migrated, and the draft and history read the same way.
 * The manager, the storefront loader and the API all go through this, so
 * one reading of a document exists.
 */
export function normalizeSliderDocument(raw: unknown): SliderDocument {
  const source = record(raw);
  const version = typeof source.version === "number" ? source.version : 1;
  const content = (part: Record<string, unknown>, migrate: boolean): SliderContent => {
    let slides = normalizeSlides(part.slides);
    if (migrate && version < SLIDER_DOCUMENT_VERSION) slides = migrateSlidesV1(slides);
    return {
      transition: part.transition === "fade" ? "fade" : "slide",
      autoplaySeconds: clampAutoplaySeconds(part.autoplaySeconds),
      controls: normalizeSliderControls(part.controls),
      slides,
    };
  };
  const doc: SliderDocument = {
    ...(source._id !== undefined && source._id !== null ? { _id: String(source._id) } : {}),
    version: SLIDER_DOCUMENT_VERSION,
    name: str(source.name, 100) || "Untitled slider",
    handle: str(source.handle, 120),
    isActive: readBoolean(source.isActive, true),
    ...content(source, true),
  };
  // A draft or a history entry only ever exists at version 2 or later.
  if (typeof source.draft === "object" && source.draft !== null) {
    const draft = record(source.draft);
    const updatedAt = isoDate(draft.updatedAt);
    doc.draft = { ...content(draft, false), ...(updatedAt ? { updatedAt } : {}) };
  }
  if (Array.isArray(source.history)) {
    doc.history = source.history.slice(0, MAX_SLIDER_HISTORY).flatMap((entry) => {
      const item = record(entry);
      const publishedAt = isoDate(item.publishedAt);
      return publishedAt ? [{ ...content(item, false), publishedAt }] : [];
    });
  }
  const publishedAt = isoDate(source.publishedAt);
  if (publishedAt) doc.publishedAt = publishedAt;
  const createdAt = isoDate(source.createdAt) ?? (source.createdAt instanceof Date ? source.createdAt.toISOString() : undefined);
  if (createdAt) doc.createdAt = createdAt;
  const updatedAt = isoDate(source.updatedAt) ?? (source.updatedAt instanceof Date ? source.updatedAt.toISOString() : undefined);
  if (updatedAt) doc.updatedAt = updatedAt;
  return doc;
}

/** The content the editor works on: the draft when there is one, else what is live. */
export function sliderWorkingContent(doc: SliderDocument): SliderContent {
  const source = doc.draft ?? doc;
  return {
    transition: source.transition,
    autoplaySeconds: source.autoplaySeconds,
    controls: source.controls,
    slides: source.slides,
  };
}

/* ------------------------------------------------------------------ */
/* Templates: a slide's look without its content.                     */
/* ------------------------------------------------------------------ */

/**
 * What a template carries — everything about a slide but its own content:
 * which elements show and in what order, where the copy and the artwork
 * sit, the type styling, the buttons' chrome, the plate, the reveal. Texts,
 * background, product and links stay the slide's.
 */
export interface SlideTemplatePreset {
  elements: Record<SlideElement, boolean>;
  elementsByShape?: SliderSlide["elementsByShape"];
  order: SlideElement[];
  layout: SliderSlide["layout"];
  image: SliderSlide["image"];
  styles: SliderSlide["styles"];
  ctaVariant: SlideCtaVariant;
  cta2Variant: SlideCtaVariant;
  artInFront: boolean;
  plate?: SlidePlate;
  reveal: SlideReveal;
  revealDuration?: number;
  revealStagger?: number;
  revealEasing?: SlideRevealEasing;
}

export interface SlideTemplate {
  id: string;
  name: string;
  preset: SlideTemplatePreset;
}

/** The look of a slide, lifted off it — what "save as template" stores. */
export function slideTemplatePreset(slide: SliderSlide): SlideTemplatePreset {
  const preset: SlideTemplatePreset = structuredClone({
    elements: slide.elements,
    order: slide.order,
    layout: slide.layout,
    image: slide.image,
    styles: slide.styles,
    ctaVariant: slide.ctaVariant,
    cta2Variant: slide.cta2Variant,
    artInFront: slide.artInFront,
    reveal: slide.reveal,
  });
  if (slide.revealDuration !== undefined) preset.revealDuration = slide.revealDuration;
  if (slide.revealStagger !== undefined) preset.revealStagger = slide.revealStagger;
  if (slide.revealEasing !== undefined) preset.revealEasing = slide.revealEasing;
  if (slide.elementsByShape) preset.elementsByShape = structuredClone(slide.elementsByShape);
  if (slide.plate) preset.plate = structuredClone(slide.plate);
  return preset;
}

/** A slide wearing a template's look, keeping everything that is its own. */
export function applySlideTemplate(
  slide: SliderSlide,
  preset: SlideTemplatePreset,
): SliderSlide {
  const look = structuredClone(preset);
  const next: SliderSlide = {
    ...slide,
    elements: look.elements,
    order: look.order,
    layout: look.layout,
    image: look.image,
    styles: look.styles,
    ctaVariant: look.ctaVariant,
    cta2Variant: look.cta2Variant,
    artInFront: look.artInFront,
    reveal: look.reveal,
  };
  delete next.elementsByShape;
  delete next.plate;
  delete next.revealDuration;
  delete next.revealStagger;
  delete next.revealEasing;
  if (look.revealDuration !== undefined) next.revealDuration = look.revealDuration;
  if (look.revealStagger !== undefined) next.revealStagger = look.revealStagger;
  if (look.revealEasing !== undefined) next.revealEasing = look.revealEasing;
  if (look.elementsByShape) next.elementsByShape = look.elementsByShape;
  if (look.plate) next.plate = look.plate;
  return next;
}

/** A stored template, read with the slide's own normalizer so it can never carry a wrong value. */
export function normalizeSlideTemplate(raw: unknown): SlideTemplate | null {
  const source = record(raw);
  const id = str(source.id, 64);
  const name = str(source.name, 80);
  if (!id || !name) return null;
  const [slide] = normalizeSlides([{ id: "template", ...record(source.preset) }]);
  return { id, name, preset: slideTemplatePreset(slide) };
}

function template(
  id: string,
  name: string,
  shape: (slide: SliderSlide) => void,
): SlideTemplate {
  const slide = createSlide("template");
  shape(slide);
  return { id, name, preset: slideTemplatePreset(slide) };
}

/** The starting layouts every store gets. Names are keys the editor translates. */
export const SLIDE_TEMPLATES: readonly SlideTemplate[] = [
  template("editorial", "Editorial", (slide) => {
    slide.elements = { ...slide.elements, tagline: true, description: true };
    slide.layout.landscape = { h: "left", v: "middle", gap: 14, scale: 100 };
    slide.styles.landscape = {
      tagline: { size: 13 },
      heading: { size: 52, weight: "700", width: 55 },
      description: { size: 17, width: 45 },
    };
    slide.image.landscape = { ...slide.image.landscape, h: "right", scale: 42 };
  }),
  template("centered", "Centered", (slide) => {
    slide.elements = { ...slide.elements, tagline: true };
    slide.layout.landscape = { h: "center", v: "middle", gap: 16, scale: 100 };
    slide.styles.landscape = {
      tagline: { size: 13, width: 60 },
      heading: { size: 56, weight: "700", width: 70 },
      cta: { size: 14 },
    };
    slide.elementsByShape = { square: { tagline: false } };
  }),
  template("split", "Product split", (slide) => {
    slide.elements = { ...slide.elements, price: true, description: true };
    slide.layout.landscape = { h: "left", v: "middle", gap: 12, scale: 100 };
    slide.styles.landscape = {
      heading: { size: 44, weight: "800", width: 46 },
      description: { size: 16, width: 42 },
    };
    slide.image.landscape = { ...slide.image.landscape, h: "right", v: "bottom", scale: 48 };
    slide.elementsByShape = { square: { description: false } };
  }),
  template("caption", "Bottom caption", (slide) => {
    slide.elements = { ...slide.elements, tagline: true };
    slide.layout.landscape = { h: "left", v: "bottom", gap: 8, scale: 100 };
    slide.styles.landscape = {
      tagline: { size: 12 },
      heading: { size: 36, weight: "600", width: 50 },
      cta: { size: 13 },
    };
    slide.plate = { color: "#00000066", padding: 24, radius: 12, blur: 10 };
    slide.ctaVariant = "light";
  }),
  template("poster", "Poster", (slide) => {
    slide.elements = { ...slide.elements, cta: false, cta2: false };
    slide.layout.landscape = { h: "center", v: "middle", gap: 0, scale: 100 };
    slide.styles.landscape = {
      heading: { size: 72, weight: "800", width: 90, transform: "uppercase", letterSpacing: 4 },
    };
    slide.reveal = "zoom";
  }),
  template("two-buttons", "Two buttons", (slide) => {
    slide.elements = { ...slide.elements, description: true, cta2: true };
    slide.layout.landscape = { h: "left", v: "middle", gap: 14, scale: 100 };
    slide.styles.landscape = {
      heading: { size: 48, weight: "700", width: 55 },
      description: { size: 16, width: 45 },
    };
    slide.ctaVariant = "dark";
    slide.cta2Variant = "outline";
  }),
];

/* ------------------------------------------------------------------ */
/* Warnings: what the editor can tell about a slide before it ships.  */
/* ------------------------------------------------------------------ */

export type SlideWarning =
  | "cta-no-link"
  | "cta2-no-link"
  | "image-narrow"
  | "video-heavy"
  | "no-alt"
  | "heading-empty"
  | "low-contrast";

/** A background video heavier than this is flagged; the shop still plays it. */
export const MAX_SLIDE_VIDEO_BYTES = 8 * 1024 * 1024;


function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast between two colours, 1 (none) to 21. Unreadable hex counts as fine. */
export function contrastRatio(foreground: string, background: string): number {
  const fg = hexChannels(foreground);
  const bg = hexChannels(background);
  if (!fg || !bg) return 21;
  const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * What can be said about a slide from its data alone. Contrast is judged
 * only against a flat colour — a plate, or a solid or gradient background;
 * over a picture the editor samples the pixels under the copy itself.
 */
export function slideWarnings(
  slide: SliderSlide,
  shape: SlideShape = "landscape",
): SlideWarning[] {
  const out: SlideWarning[] = [];
  const elements = resolveSlideElements(slide, shape);
  if (elements.cta && slide.texts.cta && !slide.link && !slide.productId) out.push("cta-no-link");
  if (elements.cta2 && slide.texts.cta2 && !slide.link2) out.push("cta2-no-link");
  const { background } = slide;
  const artwork = background.type === "image" || background.type === "video";
  if (artwork && background.imageWidth && background.imageWidth < SLIDE_FRAMES.landscape.width) {
    out.push("image-narrow");
  }
  if (background.type === "video" && background.videoSize && background.videoSize > MAX_SLIDE_VIDEO_BYTES) {
    out.push("video-heavy");
  }
  if ((artwork || slide.productImage) && !slide.alt.trim()) out.push("no-alt");
  if (elements.heading && !slide.texts.heading.trim()) out.push("heading-empty");
  const plate = slide.plate && hexChannels(slide.plate.color);
  const flat =
    plate && plate.a >= 0.5 ? slide.plate!.color : artwork ? undefined : backgroundAccentColor(background);
  if (flat && elements.heading) {
    const ink = resolveTextStyle(slide, "heading", shape).color ?? (artwork ? "#ffffff" : "#1f2937");
    if (contrastRatio(ink, flat) < 3) out.push("low-contrast");
  }
  return out;
}

/**
 * The fix for copy that will not read: the ink that contrasts best with what
 * is behind it, written to the band's texts — and, over a picture that is
 * mid-toned enough for neither ink to reach 3:1, a flat darkening with light
 * copy. Returns the patch to apply, or null when nothing would help.
 */
export function suggestContrastFix(
  slide: SliderSlide,
  shape: SlideShape,
  behind: string,
): Partial<SliderSlide> | null {
  const LIGHT = "#ffffff";
  const DARK = "#1f2937";
  const ink = contrastRatio(LIGHT, behind) >= contrastRatio(DARK, behind) ? LIGHT : DARK;
  // A flat colour always has an ink that reads on it at 3:1. A picture's
  // sample is a MEAN — the light and dark spots it averages are what the
  // copy actually sits on — so a picture has to clear the stricter 4.5:1
  // before ink alone is called enough; otherwise it is darkened as well.
  const enough = isArtwork(resolveSlideBackground(slide, shape)) ? 4.5 : 3;
  const inkStyles = (colour: string): SliderSlide["styles"] => {
    const styles = structuredClone(slide.styles);
    const band = shape === "landscape" ? styles.landscape : (styles[shape] ??= {});
    for (const element of ["tagline", "heading", "description"] as const) {
      band[element] = { ...(band[element] ?? {}), color: colour };
    }
    return styles;
  };
  if (contrastRatio(ink, behind) >= enough) return { styles: inkStyles(ink) };
  const background = resolveSlideBackground(slide, shape);
  if (!isArtwork(background)) return { styles: inkStyles(ink) };
  const darkened: SlideBackground = {
    ...background,
    overlay: Math.max(background.overlay ?? 0, 45),
    overlayKind: "flat",
  };
  delete darkened.overlayColor;
  const patch: Partial<SliderSlide> = { styles: inkStyles(LIGHT) };
  if (shape === "landscape" || !slide.backgrounds?.[shape]) patch.background = darkened;
  else patch.backgrounds = { ...slide.backgrounds, [shape]: darkened };
  return patch;
}
