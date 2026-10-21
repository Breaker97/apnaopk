/**
 * Edits to a whole design, as the editor's store applies them. Each returns
 * a new design, or the same one when nothing changed, and keeps the identity
 * of every element it didn't touch.
 *
 * `designEquals` is the dirty rule's comparison (§4.4): the document differs
 * from the saved one, whatever the history did to get there.
 *
 * Pure and client-safe.
 */
import { CANVAS_SIZES, CUSTOM_SIZE_LIMITS, isCanvasSizeKey, type CanvasSizeKey } from "../canvas-sizes";
import { roundMm } from "../units";
import type { TemplateCanvas, TemplateDesign, TemplateElement } from "../types";
import { moveBox } from "./geometry";

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

/**
 * Structural equality for JSON-like values. Same references are equal at
 * once, so comparing two designs that share most of their elements is
 * cheap. A key holding `undefined` counts as absent, as it does once saved.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], other[i])) return false;
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!deepEqual(left[key], right[key])) return false;
  }
  return true;
}

export function designEquals(a: TemplateDesign, b: TemplateDesign): boolean {
  return deepEqual(a, b);
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/** The design with the listed elements replaced by `update`; untouched elements keep their identity. */
export function updateElements(
  design: TemplateDesign,
  ids: readonly string[],
  update: (element: TemplateElement) => TemplateElement,
): TemplateDesign {
  let changed = false;
  const elements = design.elements.map((element) => {
    if (!ids.includes(element.id)) return element;
    const next = update(element);
    if (next !== element) changed = true;
    return next;
  });
  return changed ? { ...design, elements } : design;
}

/** The design with a new element list, unless it is the same list. */
export function withElements(design: TemplateDesign, elements: TemplateElement[]): TemplateDesign {
  const same = elements.length === design.elements.length && elements.every((element, index) => element === design.elements[index]);
  return same ? design : { ...design, elements };
}

/** The unlocked elements among `ids` moved by a delta (arrow keys). */
export function nudgeElements(design: TemplateDesign, ids: readonly string[], dxMm: number, dyMm: number): TemplateDesign {
  return updateElements(design, ids, (element) =>
    element.locked ? element : (moveBox(element, dxMm, dyMm) as TemplateElement),
  );
}

/** The unlocked elements among `ids` removed. Locked ones stay until they are unlocked. */
export function removeElements(design: TemplateDesign, ids: readonly string[]): TemplateDesign {
  return withElements(
    design,
    design.elements.filter((element) => !ids.includes(element.id) || element.locked),
  );
}

export function setElementFlag(
  design: TemplateDesign,
  ids: readonly string[],
  flag: "hidden" | "locked",
  value: boolean,
): TemplateDesign {
  return updateElements(design, ids, (element) => {
    if (Boolean(element[flag]) === value) return element;
    const next = { ...element };
    if (value) next[flag] = true;
    else delete next[flag];
    return next;
  });
}

// ---------------------------------------------------------------------------
// Canvas size (§5.2: one undo step, never moves, scales or deletes elements)
// ---------------------------------------------------------------------------

/**
 * The canvas on another paper: its width, height, height mode and margins,
 * and a roll's minimum height. Grid, background and font stay. The elements
 * are not touched.
 */
export function withCanvasSize(design: TemplateDesign, key: CanvasSizeKey): TemplateDesign {
  const size = CANVAS_SIZES[key];
  const { minHeightMm: _minHeight, ...rest } = design.canvas;
  const canvas: TemplateCanvas = {
    ...rest,
    preset: key,
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    heightMode: size.heightMode,
    ...(size.heightMode === "auto" ? { minHeightMm: size.heightMm } : {}),
    marginMm: { ...size.marginMm },
  };
  return { ...design, canvas };
}

export function clampCustomSize(widthMm: number, heightMm: number): { widthMm: number; heightMm: number } {
  const clamp = (value: number, min: number, max: number) => roundMm(Math.min(max, Math.max(min, value)));
  return {
    widthMm: clamp(widthMm, CUSTOM_SIZE_LIMITS.minWidthMm, CUSTOM_SIZE_LIMITS.maxWidthMm),
    heightMm: clamp(heightMm, CUSTOM_SIZE_LIMITS.minHeightMm, CUSTOM_SIZE_LIMITS.maxHeightMm),
  };
}

/**
 * A custom width and height (D-13 limits); everything else about the canvas
 * stays, except margins that would meet on the new size, which shrink to fit.
 * `marginMm` are the margins to fit (default: the canvas's own): a size typed
 * a digit at a time ("2", "20", "200") passes these on every keystroke, so a
 * passing 20 mm doesn't leave the margins it shrank on the final size.
 */
export function withCustomSize(
  design: TemplateDesign,
  widthMm: number,
  heightMm: number,
  marginMm: TemplateCanvas["marginMm"] = design.canvas.marginMm,
): TemplateDesign {
  return { ...design, canvas: fitMargins({ ...design.canvas, preset: "custom", ...clampCustomSize(widthMm, heightMm), marginMm }) };
}

/** Margins that still leave paper between them on a smaller page (the schema refuses margins that meet). */
function fitMargins(canvas: TemplateCanvas): TemplateCanvas {
  const { top, right, bottom, left } = canvas.marginMm;
  const fit = (a: number, b: number, across: number): [number, number] => {
    if (a + b < across) return [a, b];
    const each = Math.max(0, Math.floor(((across - 1) / 2) * 10) / 10);
    return [Math.min(a, each), Math.min(b, each)];
  };
  const [nextLeft, nextRight] = fit(left, right, canvas.widthMm);
  const [nextTop, nextBottom] = fit(top, bottom, canvas.heightMm);
  if (nextLeft === left && nextRight === right && nextTop === top && nextBottom === bottom) return canvas;
  return { ...canvas, marginMm: { top: nextTop, right: nextRight, bottom: nextBottom, left: nextLeft } };
}

// ---------------------------------------------------------------------------
// Canvas settings (the Design tab with nothing selected)
// ---------------------------------------------------------------------------

/**
 * A fixed page or a roll that grows with its content. A roll keeps its
 * height as the shortest print (`minHeightMm`). The size stays a preset
 * only when that preset has this height mode; otherwise it becomes custom.
 */
export function withHeightMode(design: TemplateDesign, mode: TemplateCanvas["heightMode"]): TemplateDesign {
  const { minHeightMm: _minHeight, ...rest } = design.canvas;
  if (design.canvas.heightMode === mode) return design;
  const preset = isCanvasSizeKey(rest.preset) && CANVAS_SIZES[rest.preset].heightMode === mode ? rest.preset : "custom";
  const canvas: TemplateCanvas =
    mode === "auto" ? { ...rest, preset, heightMode: "auto", minHeightMm: rest.heightMm } : { ...rest, preset, heightMode: "fixed" };
  return { ...design, canvas };
}

export type MarginSide = keyof TemplateCanvas["marginMm"];

/** The largest margin a side can take: 100 mm, and always 1 mm of paper left between it and the opposite margin. */
export function marginLimit(canvas: TemplateCanvas, side: MarginSide): number {
  const across = side === "left" || side === "right" ? canvas.widthMm : canvas.heightMm;
  const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" } as const;
  return Math.max(0, Math.min(100, roundMm(across - canvas.marginMm[opposite[side]] - 1)));
}

export function withMargin(design: TemplateDesign, side: MarginSide, valueMm: number): TemplateDesign {
  const value = roundMm(Math.max(0, Math.min(marginLimit(design.canvas, side), valueMm)));
  if (design.canvas.marginMm[side] === value) return design;
  return { ...design, canvas: { ...design.canvas, marginMm: { ...design.canvas.marginMm, [side]: value } } };
}
