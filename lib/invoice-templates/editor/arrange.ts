/**
 * Arrange (§5.4): align to the page or the selection, distribute three or
 * more elements, layer order, duplicate (+5 mm). Rotated elements line up by
 * the box they cover on the page. A locked element never moves, but it still
 * counts when the selection's own edges are the reference.
 *
 * Every function takes the element list and returns a new one; elements that
 * didn't change keep their identity, so the history's equality check and
 * React both see exactly what moved.
 *
 * Pure and client-safe.
 */
import { printableArea } from "../canvas-sizes";
import { TEMPLATE_LIMITS, type TemplateCanvas, type TemplateElement, type TemplateLocale } from "../types";
import { boxBounds, moveBox, unionBounds, type Bounds } from "./geometry";

// ---------------------------------------------------------------------------
// Align and distribute
// ---------------------------------------------------------------------------

export const ALIGN_EDGES = ["left", "centre", "right", "top", "middle", "bottom"] as const;
export type AlignEdge = (typeof ALIGN_EDGES)[number];
/** "page" is the printable area, inside the margins: what a print can use. */
export type AlignTarget = "page" | "selection";

/** How far a box with these bounds moves so its `edge` meets the reference's. */
export function alignShift(bounds: Bounds, edge: AlignEdge, reference: Bounds): { dxMm: number; dyMm: number } {
  switch (edge) {
    case "left":
      return { dxMm: reference.minX - bounds.minX, dyMm: 0 };
    case "right":
      return { dxMm: reference.maxX - bounds.maxX, dyMm: 0 };
    case "centre":
      return { dxMm: (reference.minX + reference.maxX) / 2 - (bounds.minX + bounds.maxX) / 2, dyMm: 0 };
    case "top":
      return { dxMm: 0, dyMm: reference.minY - bounds.minY };
    case "bottom":
      return { dxMm: 0, dyMm: reference.maxY - bounds.maxY };
    case "middle":
      return { dxMm: 0, dyMm: (reference.minY + reference.maxY) / 2 - (bounds.minY + bounds.maxY) / 2 };
  }
}

/** The printable area as bounds. */
export function pageReference(canvas: TemplateCanvas): Bounds {
  const area = printableArea(canvas);
  return { minX: area.xMm, minY: area.yMm, maxX: area.xMm + area.widthMm, maxY: area.yMm + area.heightMm };
}

const moved = (element: TemplateElement, dxMm: number, dyMm: number): TemplateElement =>
  Math.abs(dxMm) < 1e-9 && Math.abs(dyMm) < 1e-9 ? element : (moveBox(element, dxMm, dyMm) as TemplateElement);

/** The selected elements lined up on one edge or centre line, of the page or of the selection. */
export function alignElements(
  elements: readonly TemplateElement[],
  ids: readonly string[],
  edge: AlignEdge,
  target: AlignTarget,
  canvas: TemplateCanvas,
): TemplateElement[] {
  const chosen = elements.filter((element) => ids.includes(element.id));
  const reference = target === "page" ? pageReference(canvas) : unionBounds(chosen);
  if (!reference) return [...elements];
  return elements.map((element) => {
    if (!ids.includes(element.id) || element.locked) return element;
    const { dxMm, dyMm } = alignShift(boxBounds(element), edge, reference);
    return moved(element, dxMm, dyMm);
  });
}

/** Distributing needs at least this many unlocked elements. */
export const DISTRIBUTE_MIN = 3;

/**
 * Equal gaps between the selected, unlocked elements along an axis, in the
 * order they sit; the selection's outer edges stay where they are.
 */
export function distributeElements(
  elements: readonly TemplateElement[],
  ids: readonly string[],
  axis: "horizontal" | "vertical",
): TemplateElement[] {
  const movable = elements.filter((element) => ids.includes(element.id) && !element.locked);
  if (movable.length < DISTRIBUTE_MIN) return [...elements];
  const horizontal = axis === "horizontal";
  const items = movable
    .map((element) => {
      const b = boxBounds(element);
      return { element, start: horizontal ? b.minX : b.minY, end: horizontal ? b.maxX : b.maxY };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const first = Math.min(...items.map((item) => item.start));
  const last = Math.max(...items.map((item) => item.end));
  const sizes = items.reduce((sum, item) => sum + (item.end - item.start), 0);
  const gap = (last - first - sizes) / (items.length - 1);
  const shifts = new Map<string, number>();
  let cursor = first;
  for (const item of items) {
    shifts.set(item.element.id, cursor - item.start);
    cursor += item.end - item.start + gap;
  }
  return elements.map((element) => {
    const shift = shifts.get(element.id);
    if (shift === undefined) return element;
    return horizontal ? moved(element, shift, 0) : moved(element, 0, shift);
  });
}

// ---------------------------------------------------------------------------
// Layer order
// ---------------------------------------------------------------------------

export type LayerMove = "forward" | "backward" | "front" | "back";

/** Elements bottom to top: by zIndex, then by their place in the list. */
export function drawingOrder(elements: readonly TemplateElement[]): TemplateElement[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.zIndex - b.element.zIndex || a.index - b.index)
    .map(({ element }) => element);
}

/**
 * The selected elements one step or all the way up or down. The list comes
 * back in drawing order with `zIndex` renumbered 0…n−1, so the two never
 * disagree; untouched elements whose number didn't change keep their identity.
 */
export function reorderLayers(elements: readonly TemplateElement[], ids: readonly string[], move: LayerMove): TemplateElement[] {
  const order = drawingOrder(elements);
  const selected = (element: TemplateElement | undefined) => Boolean(element && ids.includes(element.id));
  let next: TemplateElement[];
  if (move === "front") next = [...order.filter((e) => !selected(e)), ...order.filter(selected)];
  else if (move === "back") next = [...order.filter(selected), ...order.filter((e) => !selected(e))];
  else {
    next = [...order];
    if (move === "forward") {
      for (let i = next.length - 2; i >= 0; i -= 1) {
        if (selected(next[i]) && !selected(next[i + 1])) [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
      }
    } else {
      for (let i = 1; i < next.length; i += 1) {
        if (selected(next[i]) && !selected(next[i - 1])) [next[i], next[i - 1]] = [next[i - 1]!, next[i]!];
      }
    }
  }
  return next.map((element, index) => (element.zIndex === index ? element : { ...element, zIndex: index }));
}

/**
 * One element moved to a place in the drawing order (0 = bottom), as Layers'
 * drag does. The list comes back in drawing order with `zIndex` renumbered
 * 0…n−1, like `reorderLayers`; an unknown id changes nothing.
 */
export function moveLayerTo(elements: readonly TemplateElement[], id: string, index: number): TemplateElement[] {
  const order = drawingOrder(elements);
  const from = order.findIndex((element) => element.id === id);
  if (from < 0) return [...elements];
  const [moved] = order.splice(from, 1);
  const to = Math.max(0, Math.min(order.length, Math.round(index)));
  order.splice(to, 0, moved!);
  return order.map((element, at) => (element.zIndex === at ? element : { ...element, zIndex: at }));
}

// ---------------------------------------------------------------------------
// Ids, names, duplicate
// ---------------------------------------------------------------------------

/** The first free `<type>-<n>` id, the pattern presets use. */
export function nextElementId(type: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n += 1) {
    const id = `${type}-${n}`;
    if (!taken.has(id)) return id;
  }
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

/** `base`, or "base 2", "base 3"… whichever no other element is called (case-insensitive). */
export function uniqueElementName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(nameKey));
  const limit = TEMPLATE_LIMITS.nameLength;
  const trimmed = base.trim().slice(0, limit) || "Element";
  if (!used.has(nameKey(trimmed))) return trimmed;
  for (let n = 2; ; n += 1) {
    const suffix = ` ${n}`;
    const candidate = `${trimmed.slice(0, limit - suffix.length)}${suffix}`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

/** The word a copy's name gets, in the template's language. */
export const COPY_WORD: Record<TemplateLocale, string> = { en: "copy", bn: "কপি" };

/** How far a duplicate lands from its original (§5.4). */
export const DUPLICATE_OFFSET_MM = 5;

/**
 * Copies of the selected elements, 5 mm right and down, named "… (copy)",
 * on top of everything in their original order. Returns the new list and
 * the copies' ids (the new selection).
 */
export function duplicateElements(
  elements: readonly TemplateElement[],
  ids: readonly string[],
  locale: TemplateLocale,
): { elements: TemplateElement[]; ids: string[] } {
  const sources = drawingOrder(elements).filter((element) => ids.includes(element.id));
  const takenIds = new Set(elements.map((element) => element.id));
  const takenNames = elements.map((element) => element.name);
  let z = Math.max(0, ...elements.map((element) => element.zIndex));
  const copies = sources.map((source) => {
    const id = nextElementId(source.type, takenIds);
    takenIds.add(id);
    const name = uniqueElementName(`${source.name} (${COPY_WORD[locale]})`, takenNames);
    takenNames.push(name);
    z += 1;
    return { ...moveBox(structuredClone(source), DUPLICATE_OFFSET_MM, DUPLICATE_OFFSET_MM), id, name, zIndex: z } as TemplateElement;
  });
  return { elements: [...elements, ...copies], ids: copies.map((copy) => copy.id) };
}
