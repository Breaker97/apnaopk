/**
 * The editor's pointer and box maths (docs/INVOICE_TEMPLATE_BUILDER.md §4.4,
 * §5.4), in millimetres on the page. Zoom only scales the view: a pointer
 * movement of `px` screen pixels at zoom `z` is `px / (3.7795 × z)` mm, and
 * every value written back is rounded to the 0.1 mm a template stores.
 *
 * Boxes rotate about their centre, as the renderer draws them. Resizing a
 * rotated box works in the box's own frame and keeps the opposite handle
 * where it was on the page.
 *
 * Pure and client-safe.
 */
import { PX_PER_MM, roundMm } from "../units";
import type { TemplateElement } from "../types";

export type Box = Pick<TemplateElement, "xMm" | "yMm" | "widthMm" | "heightMm" | "rotationDeg">;
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// ---------------------------------------------------------------------------
// Zoom and pointer → mm
// ---------------------------------------------------------------------------

/** §5.2: the zoom menu runs from 25 % to 300 %. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 3;
/** The % menu, and the steps − and + walk through. */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** The next step in or out from any zoom (a fitted zoom sits between steps). */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const eps = 1e-6;
  if (direction > 0) return ZOOM_STEPS.find((step) => step > zoom + eps) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - eps) ?? ZOOM_MIN;
}

/** Screen pixels at `zoom` as millimetres on the page, unrounded. */
export function screenToMm(screenPx: number, zoom: number): number {
  if (!(zoom > 0)) return 0;
  return screenPx / (PX_PER_MM * zoom);
}

/** Millimetres on the page as screen pixels at `zoom`. */
export function mmToScreen(mm: number, zoom: number): number {
  return mm * PX_PER_MM * zoom;
}

/**
 * A point on screen as millimetres from a page's top-left corner, given
 * where that corner is on screen. Rounded to 0.1 mm.
 */
export function clientToPageMm(
  client: { x: number; y: number },
  pageOrigin: { x: number; y: number },
  zoom: number,
): { xMm: number; yMm: number } {
  return {
    xMm: roundMm(screenToMm(client.x - pageOrigin.x, zoom)),
    yMm: roundMm(screenToMm(client.y - pageOrigin.y, zoom)),
  };
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

const radians = (deg: number) => (deg * Math.PI) / 180;

/** The axis-aligned bounds of a box after rotation about its centre. */
export function boxBounds(box: Box): Bounds {
  const cx = box.xMm + box.widthMm / 2;
  const cy = box.yMm + box.heightMm / 2;
  const rad = radians(box.rotationDeg || 0);
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const hw = (box.widthMm * cos + box.heightMm * sin) / 2;
  const hh = (box.widthMm * sin + box.heightMm * cos) / 2;
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
}

/** The bounds around several boxes. */
export function unionBounds(boxes: readonly Box[]): Bounds | null {
  if (boxes.length === 0) return null;
  return boxes.map(boxBounds).reduce((all, b) => ({
    minX: Math.min(all.minX, b.minX),
    minY: Math.min(all.minY, b.minY),
    maxX: Math.max(all.maxX, b.maxX),
    maxY: Math.max(all.maxY, b.maxY),
  }));
}

/** A box moved by a delta, rounded to 0.1 mm. */
export function moveBox<B extends Box>(box: B, dxMm: number, dyMm: number): B {
  return { ...box, xMm: roundMm(box.xMm + dxMm), yMm: roundMm(box.yMm + dyMm) };
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

/** The eight resize handles, by compass point. */
export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** Which way a handle moves the box's width (x) and height (y): −1 the start side, +1 the end side, 0 not at all. */
export function handleSigns(handle: ResizeHandle): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  return {
    x: handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0,
    y: handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0,
  };
}

/** The smallest a resize makes a side, unless the side started smaller (a hairline rule). */
export const MIN_SIZE_MM = 1;

export interface ResizeOptions {
  /** Keep the width:height ratio (Shift). */
  keepRatio?: boolean;
  minSizeMm?: number;
}

/**
 * The box after dragging `handle` by a page-space delta. The delta is
 * turned into the box's own (rotated) frame; the side or corner opposite
 * the handle stays put on the page. Values are rounded to 0.1 mm.
 */
export function resizeBox<B extends Box>(
  box: B,
  handle: ResizeHandle,
  dxMm: number,
  dyMm: number,
  options: ResizeOptions = {},
): B {
  const signs = handleSigns(handle);
  const rad = radians(box.rotationDeg || 0);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // The delta in the box's own frame.
  const lx = dxMm * cos + dyMm * sin;
  const ly = -dxMm * sin + dyMm * cos;

  const minW = Math.min(options.minSizeMm ?? MIN_SIZE_MM, box.widthMm);
  const minH = Math.min(options.minSizeMm ?? MIN_SIZE_MM, box.heightMm);
  let width = signs.x ? box.widthMm + signs.x * lx : box.widthMm;
  let height = signs.y ? box.heightMm + signs.y * ly : box.heightMm;

  if (options.keepRatio && box.widthMm > 0 && box.heightMm > 0) {
    const ratio = box.widthMm / box.heightMm;
    if (signs.x && signs.y) {
      // A corner follows whichever side moved further, relatively.
      const scale = Math.max(width / box.widthMm, height / box.heightMm);
      width = box.widthMm * scale;
      height = box.heightMm * scale;
    } else if (signs.x) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
    const floor = Math.max(minW / box.widthMm, minH / box.heightMm);
    if (width / box.widthMm < floor) {
      width = box.widthMm * floor;
      height = box.heightMm * floor;
    }
  }
  width = Math.max(minW, width);
  height = Math.max(minH, height);

  // The anchor: the point opposite the handle (the middle of the opposite
  // side for an edge handle), in the box's frame relative to its centre.
  // For an edge handle with the ratio kept, the other axis grows about the
  // centre line, so its anchor coordinate is 0.
  const anchorLocal = { x: (-signs.x * box.widthMm) / 2, y: (-signs.y * box.heightMm) / 2 };
  const cx = box.xMm + box.widthMm / 2;
  const cy = box.yMm + box.heightMm / 2;
  const anchorPage = {
    x: cx + anchorLocal.x * cos - anchorLocal.y * sin,
    y: cy + anchorLocal.x * sin + anchorLocal.y * cos,
  };
  // Where the anchor sits in the resized box, relative to its new centre.
  const nextAnchorLocal = { x: (-signs.x * width) / 2, y: (-signs.y * height) / 2 };
  const ncx = anchorPage.x - (nextAnchorLocal.x * cos - nextAnchorLocal.y * sin);
  const ncy = anchorPage.y - (nextAnchorLocal.x * sin + nextAnchorLocal.y * cos);

  return {
    ...box,
    xMm: roundMm(ncx - width / 2),
    yMm: roundMm(ncy - height / 2),
    widthMm: roundMm(width),
    heightMm: roundMm(height),
  };
}

// ---------------------------------------------------------------------------
// Rotate
// ---------------------------------------------------------------------------

/** Shift snaps rotation to this step (§5.4). */
export const ROTATION_SNAP_DEG = 15;

/** An angle in (−180, 180], at 0.1° precision. */
export function normalizeDeg(deg: number): number {
  let value = deg % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** The angle (degrees, clockwise from "up") from a box's centre to a point. */
export function angleFromCentre(box: Box, point: { xMm: number; yMm: number }): number {
  const cx = box.xMm + box.widthMm / 2;
  const cy = box.yMm + box.heightMm / 2;
  return (Math.atan2(point.yMm - cy, point.xMm - cx) * 180) / Math.PI + 90;
}

/**
 * The rotation after turning the rotate handle from `from` to `to` (both
 * page points), starting at `startDeg`. `snap` (Shift) lands on 15° steps.
 */
export function rotateBy(box: Box, startDeg: number, from: { xMm: number; yMm: number }, to: { xMm: number; yMm: number }, snap = false): number {
  const turned = startDeg + angleFromCentre(box, to) - angleFromCentre(box, from);
  return normalizeDeg(snap ? Math.round(turned / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG : turned);
}
