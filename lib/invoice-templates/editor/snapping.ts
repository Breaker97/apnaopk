/**
 * Snapping while moving or resizing on the canvas (§5.4): to page edges, the
 * page centre and the margins, to other elements' edges and centres (each
 * with a guide line), and otherwise to the grid. Alt turns it off; the caller
 * simply doesn't snap.
 *
 * The threshold is a fixed distance ON SCREEN, so snapping feels the same at
 * every zoom: `snapThresholdMm(zoom)` turns it into page millimetres.
 *
 * Pure and client-safe.
 */
import { printableArea } from "../canvas-sizes";
import type { TemplateCanvas } from "../types";
import { boxBounds, screenToMm, type Bounds, type Box } from "./geometry";

/** How close (screen px) an edge or centre has to come before it snaps. */
export const SNAP_SCREEN_PX = 6;

export function snapThresholdMm(zoom: number): number {
  return screenToMm(SNAP_SCREEN_PX, zoom);
}

export type SnapKind = "page" | "centre" | "margin" | "element";
export type SnapLine = { mm: number; kind: SnapKind };
export type SnapGuide = { axis: "x" | "y"; mm: number; kind: SnapKind };
export type SnapTargets = { x: SnapLine[]; y: SnapLine[] };

/**
 * Every line something can snap to on a page `pageHeightMm` tall (a roll's
 * page is as tall as it currently lays out): the page's edges and centre,
 * the margins, and the edges and centres of `others`.
 */
export function snapTargets(canvas: TemplateCanvas, pageHeightMm: number, others: readonly Box[]): SnapTargets {
  const area = printableArea({ ...canvas, heightMm: pageHeightMm });
  const x: SnapLine[] = [
    { mm: 0, kind: "page" },
    { mm: canvas.widthMm, kind: "page" },
    { mm: canvas.widthMm / 2, kind: "centre" },
    { mm: area.xMm, kind: "margin" },
    { mm: area.xMm + area.widthMm, kind: "margin" },
  ];
  const y: SnapLine[] = [
    { mm: 0, kind: "page" },
    { mm: pageHeightMm, kind: "page" },
    { mm: pageHeightMm / 2, kind: "centre" },
    { mm: area.yMm, kind: "margin" },
    { mm: area.yMm + area.heightMm, kind: "margin" },
  ];
  for (const other of others) {
    const b = boxBounds(other);
    x.push({ mm: b.minX, kind: "element" }, { mm: (b.minX + b.maxX) / 2, kind: "element" }, { mm: b.maxX, kind: "element" });
    y.push({ mm: b.minY, kind: "element" }, { mm: (b.minY + b.maxY) / 2, kind: "element" }, { mm: b.maxY, kind: "element" });
  }
  return { x, y };
}

/**
 * The nearest target line to any of `values` within `thresholdMm`: how far
 * to shift so that value lands on it, and the guide to draw. Ties go to the
 * earlier value, then to the earlier line.
 */
export function nearestSnap(
  values: readonly number[],
  lines: readonly SnapLine[],
  thresholdMm: number,
): { shift: number; line: SnapLine } | null {
  let best: { shift: number; line: SnapLine } | null = null;
  for (const value of values) {
    for (const line of lines) {
      const shift = line.mm - value;
      if (Math.abs(shift) > thresholdMm + 1e-9) continue;
      if (!best || Math.abs(shift) < Math.abs(best.shift) - 1e-9) best = { shift, line };
    }
  }
  return best;
}

/** How far a value has to shift to land on the grid. */
export function gridShift(value: number, gridMm: number): number {
  if (!(gridMm > 0)) return 0;
  return Math.round(value / gridMm) * gridMm - value;
}

export interface SnapMoveOptions {
  targets: SnapTargets;
  thresholdMm: number;
  /** Fall back to the grid on an axis with no guide; 0 = no grid. */
  gridMm: number;
}

/**
 * A move of the selection whose bounds are `bounds` by (dx, dy), snapped:
 * on each axis the selection's start edge, centre or end edge lands on the
 * nearest target line within the threshold (and that guide shows), else its
 * start edge lands on the grid.
 */
export function snapMove(
  bounds: Bounds,
  dxMm: number,
  dyMm: number,
  options: SnapMoveOptions,
): { dxMm: number; dyMm: number; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  const axis = (axisName: "x" | "y", start: number, end: number, delta: number): number => {
    const moved = [start + delta, (start + end) / 2 + delta, end + delta];
    const hit = nearestSnap(moved, options.targets[axisName], options.thresholdMm);
    if (hit) {
      guides.push({ axis: axisName, mm: hit.line.mm, kind: hit.line.kind });
      return delta + hit.shift;
    }
    return delta + gridShift(start + delta, options.gridMm);
  };
  return {
    dxMm: axis("x", bounds.minX, bounds.maxX, dxMm),
    dyMm: axis("y", bounds.minY, bounds.maxY, dyMm),
    guides,
  };
}

/**
 * A resized, unrotated box with the sides that moved snapped: the left or
 * right side (and top or bottom) the handle drags lands on a target line
 * within the threshold, else on the grid. The other sides stay where they are.
 */
export function snapResize<B extends Box>(
  box: B,
  moving: { x: -1 | 0 | 1; y: -1 | 0 | 1 },
  options: SnapMoveOptions,
): { box: B; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  let { xMm, yMm, widthMm, heightMm } = box;
  const side = (axisName: "x" | "y", value: number): number => {
    const hit = nearestSnap([value], options.targets[axisName], options.thresholdMm);
    if (hit) {
      guides.push({ axis: axisName, mm: hit.line.mm, kind: hit.line.kind });
      return hit.shift;
    }
    return gridShift(value, options.gridMm);
  };
  if (moving.x === 1) widthMm += side("x", xMm + widthMm);
  if (moving.x === -1) {
    const shift = side("x", xMm);
    xMm += shift;
    widthMm -= shift;
  }
  if (moving.y === 1) heightMm += side("y", yMm + heightMm);
  if (moving.y === -1) {
    const shift = side("y", yMm);
    yMm += shift;
    heightMm -= shift;
  }
  const round = (value: number) => Math.round(value * 10) / 10;
  if (widthMm <= 0 || heightMm <= 0) return { box, guides: [] };
  return { box: { ...box, xMm: round(xMm), yMm: round(yMm), widthMm: round(widthMm), heightMm: round(heightMm) }, guides };
}
