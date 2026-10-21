/**
 * Out-of-bounds and overlap checks (docs/INVOICE_TEMPLATE_BUILDER.md §4.2,
 * §5.5), rotation-aware: an element's four corners after rotation about its
 * centre must sit inside the printable area, and two elements overlap when
 * their rotated rectangles intersect (separating-axis test).
 *
 * Decorations (`box`, `line`) are drawn under or across other elements on
 * purpose, so they never count as overlapping anything. Elements that can
 * never share a page (`first` with `notFirst`) don't either. A roll grows
 * downward, so its printable area has no bottom.
 *
 * Client-safe.
 */
import { printableArea } from "./canvas-sizes";
import type { ElementType, ShowOn, TemplateCanvas, TemplateElement } from "./types";

const EPS = 0.05;

export type Point = { x: number; y: number };

type Geometry = Pick<TemplateElement, "xMm" | "yMm" | "widthMm" | "heightMm" | "rotationDeg">;

/** The four corners after rotation about the centre, clockwise from top-left. */
export function elementCorners(element: Geometry): Point[] {
  const cx = element.xMm + element.widthMm / 2;
  const cy = element.yMm + element.heightMm / 2;
  const rad = ((element.rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = element.widthMm / 2;
  const hh = element.heightMm / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([dx, dy]) => ({ x: cx + dx! * cos - dy! * sin, y: cy + dx! * sin + dy! * cos }));
}

/** The axis-aligned box around the rotated element. */
export function elementBounds(element: Geometry): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = elementCorners(element);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export interface BoundsOptions {
  /** Check against the page edges instead of the margins. */
  area?: "printable" | "page";
}

/** Whether any part of the element lies outside the printable area (or the page). */
export function isOutOfBounds(element: Geometry, canvas: TemplateCanvas, options: BoundsOptions = {}): boolean {
  const area =
    options.area === "page"
      ? { xMm: 0, yMm: 0, widthMm: canvas.widthMm, heightMm: canvas.heightMm }
      : printableArea(canvas);
  const bounds = elementBounds(element);
  if (bounds.minX < area.xMm - EPS) return true;
  if (bounds.minY < area.yMm - EPS) return true;
  if (bounds.maxX > area.xMm + area.widthMm + EPS) return true;
  if (canvas.heightMode === "auto") return false;
  return bounds.maxY > area.yMm + area.heightMm + EPS;
}

function project(points: Point[], axis: Point): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const value = point.x * axis.x + point.y * axis.y;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return [min, max];
}

function axesOf(corners: Point[]): Point[] {
  const axes: Point[] = [];
  for (let index = 0; index < 2; index += 1) {
    const a = corners[index]!;
    const b = corners[index + 1]!;
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const length = Math.hypot(edge.x, edge.y);
    if (length < 1e-9) continue;
    axes.push({ x: -edge.y / length, y: edge.x / length });
  }
  return axes;
}

/** Whether two rotated rectangles share any area (touching edges don't count). */
export function elementsOverlap(a: Geometry, b: Geometry): boolean {
  if (a.widthMm <= 0 || a.heightMm <= 0 || b.widthMm <= 0 || b.heightMm <= 0) return false;
  const cornersA = elementCorners(a);
  const cornersB = elementCorners(b);
  for (const axis of [...axesOf(cornersA), ...axesOf(cornersB)]) {
    const [minA, maxA] = project(cornersA, axis);
    const [minB, maxB] = project(cornersB, axis);
    if (maxA <= minB + EPS || maxB <= minA + EPS) return false;
  }
  return true;
}

/** Whether two elements can ever print on the same page. */
export function canSharePage(a: ShowOn, b: ShowOn): boolean {
  return !((a === "first" && b === "notFirst") || (a === "notFirst" && b === "first"));
}

export type BoundsWarning =
  | { kind: "outOfBounds"; elementId: string; name: string }
  | { kind: "overlap"; elementIds: [string, string]; names: [string, string] };

export interface CheckBoundsOptions extends BoundsOptions {
  /** Types that never count as overlapping (decorations by default). */
  ignoreOverlapOf?: readonly ElementType[];
}

const DECORATIONS: readonly ElementType[] = ["box", "line"];

/** Every out-of-bounds element and every overlapping pair, by element name. */
export function checkBounds(
  canvas: TemplateCanvas,
  elements: readonly TemplateElement[],
  options: CheckBoundsOptions = {},
): BoundsWarning[] {
  const ignore = options.ignoreOverlapOf ?? DECORATIONS;
  const visible = elements.filter((element) => !element.hidden);
  const warnings: BoundsWarning[] = [];
  for (const element of visible) {
    if (isOutOfBounds(element, canvas, options)) {
      warnings.push({ kind: "outOfBounds", elementId: element.id, name: element.name });
    }
  }
  const content = visible.filter((element) => !ignore.includes(element.type));
  for (let i = 0; i < content.length; i += 1) {
    for (let j = i + 1; j < content.length; j += 1) {
      const a = content[i]!;
      const b = content[j]!;
      if (!canSharePage(a.showOn, b.showOn)) continue;
      if (elementsOverlap(a, b)) {
        warnings.push({ kind: "overlap", elementIds: [a.id, b.id], names: [a.name, b.name] });
      }
    }
  }
  return warnings;
}
