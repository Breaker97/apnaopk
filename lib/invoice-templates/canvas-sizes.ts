/**
 * Canvas sizes (docs/INVOICE_TEMPLATE_BUILDER.md §5.10, D-13). A size gives
 * the page width, its height (or the design height of a roll), the margins a
 * new canvas starts with, and which category starts on it.
 *
 * Client-safe.
 */
import type { TemplateCanvas, TemplateCategory } from "./types";

export type CanvasSizeKey =
  | "a4-portrait"
  | "a4-landscape"
  | "a5-portrait"
  | "a5-landscape"
  | "thermal-80"
  | "thermal-58"
  | "sticker-100x150"
  | "sticker-76x102"
  | "sticker-51x76";

export type CanvasSize = {
  key: CanvasSizeKey;
  widthMm: number;
  /** For a roll, the design height a new canvas starts with. */
  heightMm: number;
  heightMode: TemplateCanvas["heightMode"];
  /** Printable width for a roll (the head's width), and the margins that leave it. */
  marginMm: TemplateCanvas["marginMm"];
};

const margins = (all: number, sides = all) => ({ top: all, right: sides, bottom: all, left: sides });

export const CANVAS_SIZES: Record<CanvasSizeKey, CanvasSize> = {
  "a4-portrait": { key: "a4-portrait", widthMm: 210, heightMm: 297, heightMode: "fixed", marginMm: margins(10) },
  "a4-landscape": { key: "a4-landscape", widthMm: 297, heightMm: 210, heightMode: "fixed", marginMm: margins(10) },
  "a5-portrait": { key: "a5-portrait", widthMm: 148, heightMm: 210, heightMode: "fixed", marginMm: margins(8) },
  "a5-landscape": { key: "a5-landscape", widthMm: 210, heightMm: 148, heightMode: "fixed", marginMm: margins(8) },
  // 72 mm printable on an 80 mm roll, 48 mm on 58 mm.
  "thermal-80": { key: "thermal-80", widthMm: 80, heightMm: 150, heightMode: "auto", marginMm: margins(2, 4) },
  "thermal-58": { key: "thermal-58", widthMm: 58, heightMm: 120, heightMode: "auto", marginMm: margins(2, 5) },
  "sticker-100x150": { key: "sticker-100x150", widthMm: 100, heightMm: 150, heightMode: "fixed", marginMm: margins(3) },
  "sticker-76x102": { key: "sticker-76x102", widthMm: 76, heightMm: 102, heightMode: "fixed", marginMm: margins(3) },
  "sticker-51x76": { key: "sticker-51x76", widthMm: 51, heightMm: 76, heightMode: "fixed", marginMm: margins(2) },
};

export const CANVAS_SIZE_KEYS = Object.keys(CANVAS_SIZES) as CanvasSizeKey[];

/** A custom size's bounds (D-13). */
export const CUSTOM_SIZE_LIMITS = {
  minWidthMm: 20,
  maxWidthMm: 500,
  minHeightMm: 20,
  maxHeightMm: 1000,
} as const;

/** The size each category's new templates start on. */
export const CATEGORY_DEFAULT_SIZE: Record<TemplateCategory, CanvasSizeKey> = {
  online: "a4-portrait",
  pos: "thermal-80",
  sticker: "sticker-100x150",
};

export function isCanvasSizeKey(value: unknown): value is CanvasSizeKey {
  return typeof value === "string" && value in CANVAS_SIZES;
}

/** A canvas on a size, with the template-wide defaults. */
export function canvasForSize(key: CanvasSizeKey, overrides: Partial<TemplateCanvas> = {}): TemplateCanvas {
  const size = CANVAS_SIZES[key];
  return {
    preset: key,
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    heightMode: size.heightMode,
    ...(size.heightMode === "auto" ? { minHeightMm: size.heightMm } : {}),
    marginMm: { ...size.marginMm },
    gridMm: 1,
    background: "#ffffff",
    defaultFont: size.heightMode === "auto" ? "compact-thermal" : "clean-sans",
    ...overrides,
  };
}

/** The area inside the margins, in mm from the page's top-left corner. */
export function printableArea(canvas: Pick<TemplateCanvas, "widthMm" | "heightMm" | "marginMm">) {
  const { top, right, bottom, left } = canvas.marginMm;
  return {
    xMm: left,
    yMm: top,
    widthMm: Math.max(0, canvas.widthMm - left - right),
    heightMm: Math.max(0, canvas.heightMm - top - bottom),
  };
}
