/**
 * The background contract — a colour, a gradient, a picture or a video, with
 * its overlay, blur, motion and focal point — and the CSS it paints.
 *
 * Its own module because slides are not its only owner: every header row and
 * item has one, and the header ships on every storefront page. Living in
 * lib/sliders/types.ts put that whole vocabulary — 2,400 lines, which the
 * bundler does not tree-shake — into every page's first-load JS.
 * lib/sliders/types.ts re-exports all of it, so slide code imports as before.
 */
import type { CSSProperties } from "react";
import { readNumber } from "@/lib/site-config/normalize-primitives";
import { color, hexChannels, oneOf, str } from "./normalize-values";

export interface SlideGradient {
  /** "linear" uses `angle`; "radial" is the direction pad's centre dot. */
  type: "linear" | "radial";
  /** CSS angle in degrees (0 = to top), for linear gradients. */
  angle: number;
  /** 2..6 stops, `at` in 0..100, kept sorted by `at`. */
  stops: { color: string; at: number }[];
}

/**
 * What the background does under the pointer. "zoom" is for artwork — a
 * colour scaled up is the same colour; the picker offers it only there.
 */
export const SLIDE_BACKGROUND_HOVERS = ["none", "zoom", "darken", "brighten"] as const;
export type SlideBackgroundHover = (typeof SLIDE_BACKGROUND_HOVERS)[number];

export interface SlideBackground {
  type: "solid" | "gradient" | "image" | "video";
  color?: string;
  gradient?: SlideGradient;
  /** The picture, and — under a video — its poster. */
  image?: string;
  /** Video only: the file that plays, muted and looping, behind the content. */
  video?: string;
  /**
   * Artwork only (a picture or a video): darkening laid over it, 0–80 (%),
   * for copy that needs the contrast. Absent or 0 shows it as uploaded.
   */
  overlay?: number;
  /** The darkening's shape: a flat wash (default) or a scrim fading from an edge. */
  overlayKind?: (typeof SLIDE_OVERLAY_KINDS)[number];
  /** Which edge a gradient scrim starts from; default bottom. */
  overlayFrom?: (typeof SLIDE_OVERLAY_EDGES)[number];
  /** The wash's colour — a tint instead of black; default black. */
  overlayColor?: string;
  /**
   * A gradient of the merchant's own, laid over the picture: its angle, its
   * stops, its colours. The edge scrim covers the common case — darken where
   * the copy sits — but only in one colour from one edge, which a duotone
   * wash or a brand-coloured corner fade cannot be expressed as.
   * `overlay` then reads as this layer's strength.
   */
  overlayGradient?: SlideGradient;
  /** Artwork only: a blur of the picture, 0–30px. */
  blur?: number;
  /** Artwork only: a slow drift and zoom while the slide shows. */
  motion?: Exclude<SlideBackgroundMotion, "none">;
  /** A hover effect on the plate; absent means none. */
  hover?: Exclude<SlideBackgroundHover, "none">;
  /**
   * The point of interest, percent of the picture's width and height. A
   * frame that crops the picture keeps this point in view — a face near the
   * top of a tall photo survives a 16:10 phone crop. Absent means centre.
   */
  focal?: { x: number; y: number };
  /** The picture's pixel width, noted at upload, so the editor can say when it is narrower than a hero. */
  imageWidth?: number;
  /** The video's size in bytes, noted at upload, so the editor can say when it is heavy. */
  videoSize?: number;
}

/** CSS object-position / background-position for a background's focal point. */
export function focalPositionCss(background: SlideBackground): string {
  const { focal } = background;
  return focal ? `${focal.x}% ${focal.y}%` : "center";
}

export const MAX_BACKGROUND_OVERLAY = 80;
export const MAX_BACKGROUND_BLUR = 30;
/** A flat wash, or a scrim that fades from one edge. */
export const SLIDE_OVERLAY_KINDS = ["flat", "gradient", "custom"] as const;
export const SLIDE_OVERLAY_EDGES = ["bottom", "top", "left", "right"] as const;
/**
 * What the picture does while the slide shows — a slow drift and zoom, a
 * pan across, a settle from a zoom, a gentle float. Off under reduced motion.
 */
export const SLIDE_BACKGROUND_MOTIONS = ["none", "kenburns", "pan", "zoom-out", "float"] as const;
export type SlideBackgroundMotion = (typeof SLIDE_BACKGROUND_MOTIONS)[number];

/** Whether this background is artwork the darkening applies to. */
export function isArtwork(background: SlideBackground): boolean {
  return background.type === "image" || background.type === "video";
}

/** A hex colour with an alpha, as rgba(); black when the hex is unreadable. */
function rgba(hex: string | undefined, alpha: number): string {
  const channels = hexChannels(hex ?? "#000000") ?? { r: 0, g: 0, b: 0 };
  return `rgba(${channels.r},${channels.g},${channels.b},${alpha})`;
}

const OPPOSITE_EDGE = { bottom: "top", top: "bottom", left: "right", right: "left" } as const;

/**
 * The darkening as a layer's inline style; null when there is none. A flat
 * wash tints the whole picture; a gradient scrim starts at one edge — where
 * the copy sits — and fades out, so the rest of the picture keeps its light.
 */
export function backgroundOverlayCss(
  background: SlideBackground,
): CSSProperties | null {
  if (!isArtwork(background) || !background.overlay) return null;
  const alpha = background.overlay / 100;
  // The merchant's own gradient. Its stops carry their own colours and
  // alpha, so Strength scales the LAYER rather than being folded into each
  // stop — which keeps the gradient the thing they drew.
  if (background.overlayKind === "custom" && background.overlayGradient) {
    return {
      backgroundImage: buildGradientCss(background.overlayGradient),
      opacity: alpha,
    };
  }
  if (background.overlayKind === "gradient") {
    const from = background.overlayFrom ?? "bottom";
    return {
      backgroundImage: `linear-gradient(to ${OPPOSITE_EDGE[from]}, ${rgba(background.overlayColor, alpha)}, ${rgba(background.overlayColor, 0)})`,
    };
  }
  return { backgroundColor: rgba(background.overlayColor, alpha) };
}

/** The picture's blur as a filter; "none" when it has none. */
export function backgroundFilterCss(background: SlideBackground): string {
  return isArtwork(background) && background.blur ? `blur(${background.blur}px)` : "none";
}

/**
 * The file a video background plays; "" for every other kind. A surface
 * paints `backgroundCss` (the poster, where there is one) and lays
 * `<BackgroundVideo>` over it — so a browser that cannot play the file, or
 * a visitor who asked for less motion, still sees the still.
 */
export function backgroundVideoSrc(background: SlideBackground): string {
  return background.type === "video" ? (background.video ?? "") : "";
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
  const type = oneOf(
    source.type,
    ["solid", "gradient", "image", "video"] as const,
    "solid",
  );
  const background: SlideBackground = { type };
  const solid = color(source.color);
  if (solid) background.color = solid;
  const gradient = normalizeGradient(source.gradient);
  if (gradient) background.gradient = gradient;
  const image = str(source.image, 1000);
  if (image) background.image = image;
  const video = str(source.video, 1000);
  if (video) background.video = video;
  const overlay = source.overlay;
  if (typeof overlay === "number" && Number.isFinite(overlay) && overlay > 0) {
    background.overlay = Math.min(MAX_BACKGROUND_OVERLAY, Math.round(overlay));
  }
  const hover = source.hover;
  if (
    SLIDE_BACKGROUND_HOVERS.includes(hover as SlideBackgroundHover) &&
    hover !== "none"
  ) {
    background.hover = hover as Exclude<SlideBackgroundHover, "none">;
  }
  const focal = source.focal;
  if (typeof focal === "object" && focal !== null) {
    const point = focal as Record<string, unknown>;
    if (typeof point.x === "number" && typeof point.y === "number") {
      background.focal = {
        x: readNumber(point.x, 50, 0, 100, 1),
        y: readNumber(point.y, 50, 0, 100, 1),
      };
    }
  }
  if (typeof source.imageWidth === "number" && source.imageWidth > 0) {
    background.imageWidth = Math.round(source.imageWidth);
  }
  if (typeof source.videoSize === "number" && source.videoSize > 0) {
    background.videoSize = Math.round(source.videoSize);
  }
  if (source.overlayKind === "gradient" || source.overlayKind === "custom") {
    background.overlayKind = source.overlayKind;
  }
  const overlayGradient = normalizeGradient(source.overlayGradient);
  if (overlayGradient) background.overlayGradient = overlayGradient;
  if (SLIDE_OVERLAY_EDGES.includes(source.overlayFrom as (typeof SLIDE_OVERLAY_EDGES)[number])) {
    background.overlayFrom = source.overlayFrom as (typeof SLIDE_OVERLAY_EDGES)[number];
  }
  const overlayColor = color(source.overlayColor);
  if (overlayColor) background.overlayColor = overlayColor;
  if (typeof source.blur === "number" && Number.isFinite(source.blur) && source.blur > 0) {
    background.blur = Math.min(MAX_BACKGROUND_BLUR, Math.round(source.blur));
  }
  if (
    SLIDE_BACKGROUND_MOTIONS.includes(source.motion as SlideBackgroundMotion) &&
    source.motion !== "none"
  ) {
    background.motion = source.motion as Exclude<SlideBackgroundMotion, "none">;
  }
  // A background whose chosen type has no value falls back to solid so the
  // slide never renders as a hole.
  if (type === "gradient" && !gradient) background.type = "solid";
  if (type === "image" && !image) background.type = "solid";
  // A video with nothing to play falls back to its poster, and to solid
  // without one — the same rule every other empty mode follows.
  if (type === "video" && !video) background.type = image ? "image" : "solid";
  return background;
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
    case "video":
      return Boolean(background.video);
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
  // A video paints its POSTER here; `<BackgroundVideo>` plays over it.
  if (
    (background.type === "image" || background.type === "video") &&
    background.image
  ) {
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
  if (isArtwork(background)) return undefined;
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
