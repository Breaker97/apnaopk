import type {
  Alignment,
  HomeCta,
  HomePaint,
  MediaFrame,
  MediaRow,
  Slide,
} from "@/contracts/mobile/shop/v1/home";
import { appBaseUrl } from "@/lib/app-url";
import type { Currency } from "@/lib/intl/currencies";
import type { RenderSliderSlide } from "@/lib/sliders/render";
import {
  isArtwork,
  resolveSlideArt,
  resolveSlideBackground,
  resolveSlideElements,
  resolveSlideLayout,
  resolveTextStyle,
  shapeForFrame,
  stripHighlights,
  type SlideBackground,
  type SlideShape,
} from "@/lib/sliders/types";
import type { DrawnGridCell } from "@/lib/storefront/section-data/slider-cells";
import type { SliderGrid } from "@/lib/storefront/sections/slider-grids";
import { imageSet } from "../images";
import { toMoney } from "../money";

/**
 * Slides and grids of slides as the app draws them: what the web shows on a
 * phone. A slide is designed per frame shape (lib/sliders/types.ts, "bands"),
 * so each frame's slides are resolved for the shape that frame has on a
 * phone, exactly as the stylesheet picks it there.
 */

/** The phone's content width in CSS px: a 390 px screen less the container's padding. */
const PHONE_WIDTH = 358;
/** The gap between two frames side by side on a phone (globals.css `--hs-gap-m`). */
const PHONE_GAP = 12;

/**
 * Where a merchant's link leads in the app: a full URL as it is, a store path
 * with a leading slash (the app's link table reads paths with or without the
 * locale). Empty means no link.
 */
export function appHref(link: string | undefined | null): string | undefined {
  const value = typeof link === "string" ? link.trim() : "";
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? value : `/${value}`;
}

/** A media file the app fetches as it is (a video): absolute, on the store's host when local. */
function mediaUrl(src: string | undefined): string | undefined {
  const value = src?.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return /^[a-z][a-z\d+.-]*:/i.test(value) ? undefined : `${appBaseUrl()}${value.startsWith("/") ? "" : "/"}${value}`;
}

const H_ALIGN: Record<string, Alignment> = { left: "START", center: "CENTER", right: "END" };
const V_ALIGN: Record<string, Alignment> = { top: "START", middle: "CENTER", bottom: "END" };

/** A background's paint (everything but its picture), or nothing to paint. */
export function toPaint(background: SlideBackground): HomePaint | undefined {
  const paint: HomePaint = {};
  if (background.type === "solid" && background.color) paint.color = background.color;
  if (background.type === "gradient" && background.gradient) {
    paint.gradient = {
      kind: background.gradient.type === "radial" ? "RADIAL" : "LINEAR",
      angle: background.gradient.angle,
      stops: background.gradient.stops.map((stop) => ({ color: stop.color, at: stop.at })),
    };
  }
  const video = background.type === "video" ? mediaUrl(background.video) : undefined;
  if (video) paint.video = video;
  if (isArtwork(background) && background.overlay) paint.overlay = background.overlay / 100;
  return Object.keys(paint).length > 0 ? paint : undefined;
}

function text(value: string | undefined, shown: boolean): string | undefined {
  const clean = shown && value ? stripHighlights(value).trim() : "";
  return clean || undefined;
}

/** A slide of a saved slider (or a banner), for a frame of `shape` on a phone. */
export function toSlide(
  slide: RenderSliderSlide,
  shape: SlideShape,
  currency: Pick<Currency, "code" | "locale">,
): Slide {
  const elements = resolveSlideElements(slide, shape);
  const background = resolveSlideBackground(slide, shape);
  const layout = resolveSlideLayout(slide, shape);
  const picture = isArtwork(background) ? imageSet(background.image, slide.alt) : undefined;
  const artwork = imageSet(resolveSlideArt(slide, shape), slide.alt);
  const paint = toPaint(background);
  const href = appHref(slide.href);
  const ctaLabel = text(slide.texts.cta, elements.cta);
  const cta2Label = text(slide.texts.cta2, elements.cta2);
  const secondHref = appHref(slide.href2);
  const textColor = resolveTextStyle(slide, "heading", shape).color;
  const cta: HomeCta | undefined = ctaLabel ? { label: ctaLabel, ...(href ? { href } : {}) } : undefined;
  const secondaryCta: HomeCta | undefined = cta2Label
    ? { label: cta2Label, ...(secondHref ? { href: secondHref } : {}) }
    : undefined;
  const price = elements.price ? slide.price : undefined;

  return {
    id: slide.id,
    ...(picture ? { image: picture } : {}),
    ...(href ? { href } : {}),
    imageFit: "STRETCH",
    ...(paint ? { background: paint } : {}),
    ...(artwork ? { artwork } : {}),
    ...optional("tagline", text(slide.texts.tagline, elements.tagline)),
    ...optional("heading", text(slide.texts.heading, elements.heading)),
    ...optional("description", text(slide.texts.description, elements.description)),
    ...(textColor ? { textColor } : {}),
    align: {
      horizontal: H_ALIGN[layout.h] ?? "START",
      vertical: V_ALIGN[layout.v] ?? "CENTER",
    },
    ...(cta ? { cta } : {}),
    ...(secondaryCta ? { secondaryCta } : {}),
    ...(price ? { price: toMoney(price.amount, currency) } : {}),
    ...(price?.compareAt !== undefined
      ? { compareAtPrice: toMoney(price.compareAt, currency) }
      : {}),
    ...(elements.countdown && slide.countdownEndsAt
      ? { countdownEndsAt: slide.countdownEndsAt }
      : {}),
  };
}

function optional<K extends string>(key: K, value: string | undefined) {
  return (value ? { [key]: value } : {}) as Partial<Record<K, string>>;
}

/** A linked static picture (a grid cell, a panel): one slide that covers its frame. */
export function pictureSlide(
  id: string,
  picture: { src: string; alt?: string; link?: string },
): Slide | null {
  const image = imageSet(picture.src, picture.alt);
  if (!image) return null;
  const href = appHref(picture.link);
  return { id, image, ...(href ? { href } : {}), imageFit: "COVER" };
}

/**
 * Each slot's place in the phone layout of a grid — rows of one or two
 * columns, a column stacking its slots — and the ratio its frame has there.
 * The web's phone rules, `.hs-grid--<key>` in app/globals.css; keep the two
 * in step (tests/mobile-api/home.test.ts checks every grid has a layout).
 * `null` is a frame as tall as the column beside it.
 */
type PhoneSlot = { slot: number; ratio: number | null };
export const PHONE_GRID_ROWS: Record<string, PhoneSlot[][][]> = {
  single: [[[{ slot: 0, ratio: 16 / 10 }]]],
  leftCategoryBar1: [[[{ slot: 0, ratio: 16 / 10 }]]],
  rightCategoryBar1: [[[{ slot: 0, ratio: 16 / 10 }]]],
  bento2: [[[{ slot: 0, ratio: 16 / 10 }]], [[{ slot: 1, ratio: 16 / 8 }]]],
  bento3: [
    [[{ slot: 0, ratio: 16 / 10 }]],
    [[{ slot: 1, ratio: 1 }], [{ slot: 2, ratio: 1 }]],
  ],
  leftCategoryBar3: [
    [[{ slot: 0, ratio: 16 / 10 }]],
    [[{ slot: 1, ratio: 1 }], [{ slot: 2, ratio: 1 }]],
  ],
  bento5: [
    [[{ slot: 0, ratio: 16 / 10 }]],
    [[{ slot: 1, ratio: 1 }], [{ slot: 2, ratio: 1 }]],
    [[{ slot: 3, ratio: 1 }], [{ slot: 4, ratio: 1 }]],
  ],
  masonry: [
    [[{ slot: 0, ratio: 4 / 5 }], [{ slot: 1, ratio: 4 / 5 }]],
    [[{ slot: 2, ratio: 4 / 5 }], [{ slot: 3, ratio: 4 / 5 }]],
  ],
  bento4: [
    [[{ slot: 0, ratio: 3 / 4 }], [{ slot: 1, ratio: 3 / 4 }]],
    [[{ slot: 2, ratio: 16 / 10 }], [{ slot: 3, ratio: 16 / 10 }]],
  ],
  duo: [[[{ slot: 0, ratio: 1 }], [{ slot: 1, ratio: 1 }]]],
  trio: [
    [[{ slot: 0, ratio: 16 / 9 }]],
    [[{ slot: 1, ratio: 1 }], [{ slot: 2, ratio: 1 }]],
  ],
  stackTop: [
    [[{ slot: 0, ratio: 16 / 9 }]],
    [[{ slot: 1, ratio: 1 }], [{ slot: 2, ratio: 1 }]],
  ],
  quad: [
    [[{ slot: 0, ratio: 1 }], [{ slot: 1, ratio: 1 }]],
    [[{ slot: 2, ratio: 1 }], [{ slot: 3, ratio: 1 }]],
  ],
  feature: [
    [[{ slot: 0, ratio: null }], [{ slot: 1, ratio: 4 / 3 }, { slot: 2, ratio: 4 / 3 }]],
    [[{ slot: 3, ratio: 5 / 2 }]],
    [[{ slot: 4, ratio: 4 / 3 }]],
  ],
  tallPair: [
    [[{ slot: 0, ratio: 3 / 4 }], [{ slot: 1, ratio: 3 / 4 }]],
    [[{ slot: 2, ratio: 4 / 3 }], [{ slot: 3, ratio: 4 / 3 }]],
    [[{ slot: 4, ratio: 5 / 2 }]],
  ],
};

/** The phone frame a slot gets: its width, and its height (from its ratio, or its row's). */
function phoneFrame(row: PhoneSlot[][], slot: PhoneSlot): { width: number; height: number } {
  const width = row.length > 1 ? (PHONE_WIDTH - PHONE_GAP) / 2 : PHONE_WIDTH;
  if (slot.ratio) return { width, height: width / slot.ratio };
  // As tall as the stack beside it.
  const height = Math.max(
    ...row.map((column) =>
      column.reduce(
        (sum, other, index) => sum + (other.ratio ? width / other.ratio : 0) + (index > 0 ? PHONE_GAP : 0),
        0,
      ),
    ),
  );
  return { width, height: height || width };
}

/** One frame of a grid: the cell's slides for its phone shape, or a plate for an empty cell. */
function toFrame(
  cell: DrawnGridCell,
  options: { id: string; frame: { width: number; height: number }; ratio: number | null },
  currency: Pick<Currency, "code" | "locale">,
): MediaFrame {
  const shape = shapeForFrame(options.frame.width, options.frame.height);
  const base = {
    id: options.id,
    ...(options.ratio ? { aspectRatio: options.ratio } : {}),
  };
  if (cell?.kind === "slider") {
    return {
      ...base,
      slides: cell.slides.map((slide) => toSlide(slide, shape, currency)),
      ...(cell.slides.length > 1 && cell.slider.autoplaySeconds > 0
        ? { autoplaySeconds: cell.slider.autoplaySeconds }
        : {}),
    };
  }
  if (cell?.kind === "image") {
    const slide = pictureSlide(`${options.id}-image`, { src: cell.image, alt: cell.alt, link: cell.link });
    return { ...base, slides: slide ? [slide] : [] };
  }
  return { ...base, slides: [] };
}

/** A grid of cells as phone rows. Frame ids are `<section id>:<slot>`. */
export function toMediaRows(
  sectionId: string,
  grid: SliderGrid,
  cells: DrawnGridCell[],
  currency: Pick<Currency, "code" | "locale">,
): MediaRow[] {
  const layout = PHONE_GRID_ROWS[grid.key] ?? PHONE_GRID_ROWS.single;
  return layout.map((row) => ({
    columns: row.map((column) =>
      column.map((slot) =>
        toFrame(
          cells[slot.slot] ?? null,
          { id: `${sectionId}:${grid.slots[slot.slot] ?? slot.slot}`, frame: phoneFrame(row, slot), ratio: slot.ratio },
          currency,
        ),
      ),
    ),
  }));
}

/** The shape of a full-width phone frame of this ratio, for a single slide or banner. */
export function phoneShape(ratio: number): SlideShape {
  return shapeForFrame(PHONE_WIDTH, PHONE_WIDTH / ratio);
}
