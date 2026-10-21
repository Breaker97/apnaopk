/**
 * Page flow (docs/INVOICE_TEMPLATE_BUILDER.md §4.5, D-06). Pure: a canvas,
 * its elements, how many item rows the order has and how tall each row is
 * (measured at 100 % by the renderer, or estimated) go in; the pages come
 * out, each with the elements it shows, where they sit and which rows of the
 * flowing block it carries.
 *
 * - Every element has `showOn` (every / first / last / notFirst).
 * - The first `productTable` / `productRows` with `flow.enabled` is the
 *   flowing block. Its box on page 1 holds as many rows as fit.
 * - Fixed-height pages: the rest continue on following pages at the same x
 *   and width, from `continuationTopMm` (default: the top margin plus the
 *   `every` / `notFirst` elements above the block), the header repeating
 *   when `repeatHeader` is on. On each page the rows start below anything
 *   shown there that reaches across that top (a `last`-only COD badge beside
 *   the header, on the last page) and stop above the first element below
 *   them, so on the last page they stop above the totals. When the last page
 *   has no room for a row, the rows fill the pages before it and the totals
 *   get one more page of their own. A row taller than a page gets a page to
 *   itself, cut off at the bottom. `rowsPerPage` overrides the counts by hand.
 * - Auto height (rolls): one page. When the block grows by Δ, everything
 *   whose top is at or below the block's original bottom moves down by Δ,
 *   and the page is as tall as `minHeightMm` or the lowest element plus the
 *   bottom margin, whichever is more.
 * - Page fields resolve per page: `pageContext` copies the context with the
 *   page's number and count.
 *
 * Client-safe.
 */
import type { PrintContext } from "./context-types";
import { FLOWING_TYPES, type ShowOn, type TemplateCanvas, type TemplateElement } from "./types";
import { pxToMm } from "./units";

const EPS = 0.01;
/** A fixed-height template never lays out more pages than this; rows past it are counted in `droppedRows`. */
export const MAX_PAGES = 500;

/** The inner padding of a product-table cell, in mm (the renderer draws the same). */
export const TABLE_CELL_PADDING_MM = 0.8;

export type FlowingElement = Extract<TemplateElement, { type: (typeof FLOWING_TYPES)[number] }>;

/** Row heights of the flowing block, measured at 100 % (mm). */
export interface RowMeasure {
  /** The table header's height; 0 when the block has none. */
  headerMm: number;
  /** One entry per item row, in order. */
  rowsMm: number[];
}

export interface PlacedRows {
  /** Row indexes `[start, end)` of the order's items shown on this page. */
  start: number;
  end: number;
  /** Whether the header prints on this page. */
  header: boolean;
  /** True on every page after the block's first. */
  continuation: boolean;
}

export interface PlacedElement {
  element: TemplateElement;
  xMm: number;
  /** Where it prints on this page: push-down and continuation move it. */
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** Only on the flowing block. */
  rows?: PlacedRows;
}

export interface PaginatedPage {
  number: number;
  count: number;
  widthMm: number;
  heightMm: number;
  /** In drawing order (ascending zIndex, then template order). */
  elements: PlacedElement[];
}

export interface Pagination {
  pages: PaginatedPage[];
  /** The flowing block's id, or null when nothing flows. */
  flowingId: string | null;
  /** Rolls only: how much the flowing block grew. */
  growthMm: number;
  /** Rows printed but cut off: taller than the room their page has for them (or put there by `rowsPerPage`). */
  clippedRows: number;
  /** Rows not printed at all: they would have needed more than `MAX_PAGES` pages. */
  droppedRows: number;
}

export interface PaginateInput {
  canvas: TemplateCanvas;
  elements: readonly TemplateElement[];
  /** How many item rows the order has. */
  rowCount: number;
  /** Measured row heights; estimated from the block's style when absent. */
  measure?: RowMeasure | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isFlowingElement(element: TemplateElement): element is FlowingElement {
  return (FLOWING_TYPES as readonly string[]).includes(element.type);
}

/** The first visible repeating block whose flow is on. */
export function findFlowingBlock(elements: readonly TemplateElement[]): FlowingElement | null {
  for (const element of elements) {
    if (element.hidden) continue;
    if (isFlowingElement(element) && element.flow?.enabled) return element;
  }
  return null;
}

/** Whether an element with `showOn` prints on page `number` of `count`. */
export function showsOnPage(showOn: ShowOn, number: number, count: number): boolean {
  switch (showOn) {
    case "first":
      return number === 1;
    case "last":
      return number === count;
    case "notFirst":
      return number > 1;
    default:
      return true;
  }
}

/** Whether a block prints a table header (only a product table can). */
export function blockHasHeader(block: FlowingElement): boolean {
  return block.type === "productTable" && block.config.showHeader;
}

/** Padding and border the block's box spends before any row, in mm. */
export function blockChromeMm(block: TemplateElement): number {
  return 2 * (block.style.paddingMm + pxToMm(block.style.borderWidthPx));
}

/**
 * A row's height when nothing has been measured yet: one line of the block's
 * font plus the cell padding (table) or the row gap (rows). The renderer
 * replaces this with real measurements once it has a DOM.
 */
export function estimateRowMeasure(block: FlowingElement, rowCount: number): RowMeasure {
  const lineMm = pxToMm(block.style.fontSizePx * block.style.lineHeight);
  const rowMm = block.type === "productTable" ? lineMm + 2 * TABLE_CELL_PADDING_MM : lineMm + block.style.gapMm;
  return {
    headerMm: blockHasHeader(block) ? rowMm : 0,
    rowsMm: Array.from({ length: Math.max(0, rowCount) }, () => rowMm),
  };
}

/** A measure padded or trimmed to `rowCount` rows (missing rows copy the last known height). */
function normalizeMeasure(block: FlowingElement, rowCount: number, measure: RowMeasure | null | undefined): RowMeasure {
  const estimate = estimateRowMeasure(block, rowCount);
  if (!measure) return estimate;
  const rows = measure.rowsMm.slice(0, rowCount);
  const filler = rows.length > 0 ? rows[rows.length - 1]! : estimate.rowsMm[0] ?? 0;
  while (rows.length < rowCount) rows.push(filler);
  return { headerMm: blockHasHeader(block) ? measure.headerMm : 0, rowsMm: rows };
}

/** How many rows from `start` fit in `capacityMm`. */
export function rowsThatFit(measure: RowMeasure, start: number, capacityMm: number): number {
  let used = 0;
  let count = 0;
  while (start + count < measure.rowsMm.length) {
    const next = measure.rowsMm[start + count]!;
    if (used + next > capacityMm + EPS) break;
    used += next;
    count += 1;
  }
  return count;
}

function sumRows(measure: RowMeasure, start: number, end: number): number {
  let total = 0;
  for (let index = start; index < end; index += 1) total += measure.rowsMm[index] ?? 0;
  return total;
}

const bottomOf = (element: Pick<TemplateElement, "yMm" | "heightMm">) => element.yMm + element.heightMm;

function overlapsHorizontally(a: TemplateElement, b: TemplateElement): boolean {
  return a.xMm < b.xMm + b.widthMm - EPS && a.xMm + a.widthMm > b.xMm + EPS;
}

/** The top margin plus the `every` / `notFirst` elements above the block, plus the block's gap. */
export function defaultContinuationTop(
  block: FlowingElement,
  elements: readonly TemplateElement[],
  canvas: TemplateCanvas,
): number {
  let top = canvas.marginMm.top;
  for (const element of elements) {
    if (element === block || element.hidden) continue;
    if (element.showOn !== "every" && element.showOn !== "notFirst") continue;
    const bottom = bottomOf(element);
    if (bottom <= block.yMm + EPS) top = Math.max(top, bottom + block.style.gapMm);
  }
  return Math.min(top, canvas.heightMm - canvas.marginMm.bottom);
}

type ContinuationRole = "middle" | "last";

/** The elements a continuation page prints besides the block, which overlap its column. On the last page the `last`-only ones too. */
function inRowsWay(block: FlowingElement, element: TemplateElement, role: ContinuationRole): boolean {
  if (element === block || element.hidden) return false;
  const shown = element.showOn === "every" || element.showOn === "notFirst" || (role === "last" && element.showOn === "last");
  return shown && overlapsHorizontally(element, block);
}

/**
 * Where rows start on a continuation page: `top`, or lower when an element
 * printed on that page reaches across it (a `last`-only COD badge beside the
 * header that runs lower than the header). Box and line decorations don't
 * push the rows (a frame around the page would push them off it), as they
 * don't count as overlaps in `checkBounds` either.
 */
function continuationStart(block: FlowingElement, elements: readonly TemplateElement[], top: number, role: ContinuationRole): number {
  let start = top;
  for (let moved = true; moved; ) {
    moved = false;
    for (const element of elements) {
      if (!inRowsWay(block, element, role) || element.type === "box" || element.type === "line") continue;
      if (element.yMm < start - EPS && bottomOf(element) > start + EPS) {
        start = bottomOf(element) + block.style.gapMm;
        moved = true;
      }
    }
  }
  return start;
}

/**
 * Where rows must stop on a continuation page: the bottom margin, or the top
 * of the first element that sits below the rows' start and overlaps them
 * horizontally. On the last page the `last`-only elements count too.
 */
function continuationBottom(
  block: FlowingElement,
  elements: readonly TemplateElement[],
  canvas: TemplateCanvas,
  start: number,
  role: ContinuationRole,
): number {
  let limit = canvas.heightMm - canvas.marginMm.bottom;
  for (const element of elements) {
    if (!inRowsWay(block, element, role)) continue;
    if (element.yMm >= start - EPS) limit = Math.min(limit, element.yMm - block.style.gapMm);
  }
  return limit;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function sortForDrawing(placed: PlacedElement[]): PlacedElement[] {
  return placed
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.element.zIndex - b.entry.element.zIndex || a.index - b.index)
    .map(({ entry }) => entry);
}

function place(element: TemplateElement, overrides: Partial<PlacedElement> = {}): PlacedElement {
  return {
    element,
    xMm: element.xMm,
    yMm: element.yMm,
    widthMm: element.widthMm,
    heightMm: element.heightMm,
    ...overrides,
  };
}

/** One page's elements: everything that shows on it, the flowing block placed as told. */
function buildPage(
  number: number,
  count: number,
  canvas: TemplateCanvas,
  elements: readonly TemplateElement[],
  block: FlowingElement | null,
  blockPlacement: PlacedElement | null,
  heightMm = canvas.heightMm,
  shiftFrom: number | null = null,
  shiftBy = 0,
): PaginatedPage {
  const placed: PlacedElement[] = [];
  for (const element of elements) {
    if (element.hidden) continue;
    if (element === block) {
      if (blockPlacement) placed.push(blockPlacement);
      continue;
    }
    if (!showsOnPage(element.showOn, number, count)) continue;
    const pushed = shiftFrom !== null && element.yMm >= shiftFrom - EPS ? shiftBy : 0;
    placed.push(place(element, { yMm: element.yMm + pushed }));
  }
  return { number, count, widthMm: canvas.widthMm, heightMm, elements: sortForDrawing(placed) };
}

type Slice = { start: number; end: number; top: number; header: boolean; continuation: boolean; heightMm: number };

/** How many of rows `[start, end)` end below `roomMm`, counting from a box whose header and chrome take `usedMm`. */
function rowsCutOff(measure: RowMeasure, start: number, end: number, usedMm: number, roomMm: number): number {
  let used = usedMm;
  let cut = 0;
  for (let index = start; index < end; index += 1) {
    used += measure.rowsMm[index] ?? 0;
    if (used > roomMm + EPS) cut += 1;
  }
  return cut;
}

function paginateFixed(input: PaginateInput, block: FlowingElement, measure: RowMeasure): Pagination {
  const { canvas, elements, rowCount } = input;
  const flow = block.flow;
  const override = flow.rowsPerPage ?? {};
  const hasHeader = blockHasHeader(block);
  const chrome = blockChromeMm(block);
  const header = hasHeader ? measure.headerMm : 0;
  // A null slice is a page for the totals alone: the block doesn't print on it.
  const slices: (Slice | null)[] = [];
  let clippedRows = 0;

  // Page 1: the block's own box.
  const firstCapacity = block.heightMm - chrome - header;
  const firstRows = override.first !== undefined ? Math.min(override.first, rowCount) : rowsThatFit(measure, 0, firstCapacity);
  clippedRows += rowsCutOff(measure, 0, firstRows, chrome + header, block.heightMm);
  slices.push({ start: 0, end: firstRows, top: block.yMm, header: hasHeader, continuation: false, heightMm: block.heightMm });

  // Following pages, from the continuation top down to whatever sits below.
  const top = flow.continuationTopMm ?? defaultContinuationTop(block, elements, canvas);
  const continuationHeader = hasHeader && flow.repeatHeader ? header : 0;
  const room = (role: ContinuationRole) => {
    const start = continuationStart(block, elements, top, role);
    return { top: start, roomMm: continuationBottom(block, elements, canvas, start, role) - start };
  };
  const middle = room("middle");
  const last = room("last");
  const rowSpace = (roomMm: number) => roomMm - chrome - continuationHeader;
  const pushContinuation = (start: number, end: number, page: { top: number; roomMm: number }) => {
    clippedRows += rowsCutOff(measure, start, end, chrome + continuationHeader, page.roomMm);
    const natural = chrome + continuationHeader + sumRows(measure, start, end);
    slices.push({ start, end, top: page.top, header: continuationHeader > 0, continuation: true, heightMm: Math.max(0, Math.min(natural, page.roomMm)) });
  };

  let placedRows = firstRows;
  let rowsOnLastPage = firstRows === rowCount;
  // The loop leaves one page free, for the totals should the rows need it.
  while (placedRows < rowCount && slices.length < MAX_PAGES - 1) {
    const start = placedRows;
    const remaining = rowCount - start;
    const lastCapacity = override.last ?? rowsThatFit(measure, start, rowSpace(last.roomMm));
    if (remaining <= lastCapacity) {
      pushContinuation(start, rowCount, last);
      placedRows = rowCount;
      rowsOnLastPage = true;
      break;
    }
    // A middle page. A row too tall for any page still gets one to itself, cut off at the bottom.
    const middleCapacity = Math.max(1, override.middle ?? rowsThatFit(measure, start, rowSpace(middle.roomMm)));
    // While the last page has room for a row, a middle page keeps one back for it, so the totals never print beside an
    // empty table. When it has none, the rows fill the middle pages and the totals get one more page of their own (§4.5).
    const taken = lastCapacity > 0 ? Math.min(middleCapacity, remaining - 1) : Math.min(middleCapacity, remaining);
    pushContinuation(start, start + taken, middle);
    placedRows = start + taken;
  }
  if (!rowsOnLastPage) slices.push(null);

  const count = slices.length;
  const pages = slices.map((slice, index) =>
    buildPage(
      index + 1,
      count,
      canvas,
      elements,
      block,
      slice
        ? place(block, {
            yMm: slice.top,
            heightMm: slice.heightMm,
            rows: { start: slice.start, end: slice.end, header: slice.header, continuation: slice.continuation },
          })
        : null,
    ),
  );
  return { pages, flowingId: block.id, growthMm: 0, clippedRows, droppedRows: rowCount - placedRows };
}

function paginateRoll(input: PaginateInput, block: FlowingElement | null, measure: RowMeasure | null): Pagination {
  const { canvas, elements, rowCount } = input;
  let growthMm = 0;
  let blockPlacement: PlacedElement | null = null;
  let shiftFrom: number | null = null;

  if (block && measure) {
    const natural = blockChromeMm(block) + measure.headerMm + sumRows(measure, 0, rowCount);
    growthMm = Math.max(0, natural - block.heightMm);
    shiftFrom = bottomOf(block);
    blockPlacement = place(block, {
      heightMm: Math.max(block.heightMm, natural),
      rows: { start: 0, end: rowCount, header: blockHasHeader(block), continuation: false },
    });
  }

  const page = buildPage(1, 1, canvas, elements, block, blockPlacement, canvas.heightMm, shiftFrom, growthMm);
  const lowest = page.elements.reduce((max, entry) => Math.max(max, entry.yMm + entry.heightMm), 0);
  page.heightMm = Math.max(canvas.minHeightMm ?? canvas.heightMm, lowest + canvas.marginMm.bottom);
  return { pages: [page], flowingId: block?.id ?? null, growthMm, clippedRows: 0, droppedRows: 0 };
}

/** Lays a template out on its pages (§4.5). */
export function paginate(input: PaginateInput): Pagination {
  const rowCount = Math.max(0, Math.floor(input.rowCount));
  const block = findFlowingBlock(input.elements);
  const measure = block ? normalizeMeasure(block, rowCount, input.measure) : null;
  if (input.canvas.heightMode === "auto") return paginateRoll({ ...input, rowCount }, block, measure);
  if (!block || !measure) {
    return { pages: [buildPage(1, 1, input.canvas, input.elements, null, null)], flowingId: null, growthMm: 0, clippedRows: 0, droppedRows: 0 };
  }
  return paginateFixed({ ...input, rowCount }, block, measure);
}

/** The context a page renders with: the same data, its own page number and count. */
export function pageContext(context: PrintContext, page: Pick<PaginatedPage, "number" | "count">): PrintContext {
  return { ...context, page: { number: page.number, count: page.count } };
}
