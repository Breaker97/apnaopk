import { SLIDER_GRIDS } from "@/lib/storefront/sections/slider-grids";

/**
 * Where a slider actually lands on the shop, as numbers.
 *
 * The band a slide wears is decided by its own frame — `shapeForFrame` on
 * the box a container query measures — and that frame depends on the grid
 * it was dropped into, WHICH SLOT of that grid, the section's height
 * setting, which section type it is (the hero and the promotion grid ship
 * different height tables), the page width the theme sets, and the
 * viewport. The editor knew none of that: it drew three fixed artboards and
 * hoped. A merchant tuned a headline in a 1248x450 landscape board and the
 * shop rendered the same slide square in a 639x450 cell.
 *
 * This module is the arithmetic that answers "what frame is this, really".
 * Pure and client-safe, so the editor, the page builder and a test can all
 * ask the same question and get the same answer.
 *
 * WHAT IT CANNOT KNOW, and says so rather than guessing: `svh` depends on
 * the device's collapsible browser chrome; `--store-chrome-h` is measured
 * in the browser; and the featured-collection panel's height above `lg` is
 * the product shelf's own height, which is a function of how long the
 * translated product titles are. Every frame carries `exact`, and a frame
 * that is not exact is labelled in the UI rather than presented as truth.
 */

/** The viewports the frames are computed at — the three the shop is designed for. */
export const PLACEMENT_VIEWPORTS = [
  { key: "desktop", label: "Desktop", width: 1440, height: 900 },
  { key: "tablet", label: "Tablet", width: 768, height: 1024 },
  { key: "phone", label: "Phone", width: 390, height: 844 },
] as const;

export type PlacementViewportKey = (typeof PLACEMENT_VIEWPORTS)[number]["key"];

/**
 * The share of the viewport's height each height setting takes, from `lg`
 * up. Lifted out of the Tailwind class maps in the two section definitions
 * (`lg:h-[50svh]` and friends) so the number exists once and both the CSS
 * and this arithmetic read it.
 */
export const HERO_HEIGHT_SHARE: Record<string, number> = {
  quarter: 0.3,
  half: 0.5,
  threeFifths: 0.6,
  threeQuarters: 0.7,
  fourFifths: 0.78,
  full: 0.85,
};

/** The promotion grid sits lower than the hero: its own table, not the hero's. */
export const PROMO_HEIGHT_SHARE: Record<string, number> = {
  quarter: 0.26,
  half: 0.38,
  threeFifths: 0.45,
  threeQuarters: 0.52,
  fourFifths: 0.6,
  full: 0.7,
};

/** The header chrome a full-height placement sits under, until the browser measures it. */
const ASSUMED_CHROME_PX = 80;

/** Below this the grid uses its stacked templates; from it, the desktop tracks. */
const DESKTOP_MIN_WIDTH = 1024;
/** The middle tier, where the desktop templates apply but the height classes do not. */
const TABLET_MIN_WIDTH = 768;

/**
 * The sub-desktop layouts, which live only as hand-written `.hs-grid--*`
 * rules in `app/globals.css`. Transcribed here so the arithmetic can reach
 * them; `tests/slider-placement.test.ts` pins every entry against the
 * stylesheet, so the two cannot drift apart silently.
 *
 * `columns` is how many columns the template has at that tier; `areas` is
 * the row-by-row area map; `ratio` is the aspect ratio of a named cell, and
 * `gridRatio` the ratio of the whole grid box when the CSS states it there
 * instead (the `feature` and `tallPair` grids do that at the middle tier).
 */
interface TierTemplate {
  columns: number;
  areas: string[][];
  ratio?: Record<string, number>;
  gridRatio?: number;
}

const R = {
  "16/7": 16 / 7,
  "16/9": 16 / 9,
  "16/10": 16 / 10,
  "16/8": 16 / 8,
  "1/1": 1,
  "4/3": 4 / 3,
  "3/4": 3 / 4,
  "4/5": 4 / 5,
  "5/2": 5 / 2,
  "3/1": 3,
} as const;

/** Phone tier: under 640px. */
const PHONE_TEMPLATES: Record<string, TierTemplate> = {
  single: { columns: 1, areas: [["a"]], ratio: { a: R["16/10"] } },
  bento2: { columns: 1, areas: [["a"], ["b"]], ratio: { a: R["16/10"], b: R["16/8"] } },
  bento3: {
    columns: 2,
    areas: [["a", "a"], ["b", "c"]],
    ratio: { a: R["16/10"], b: R["1/1"], c: R["1/1"] },
  },
  bento5: {
    columns: 2,
    areas: [["a", "a"], ["b", "c"], ["d", "e"]],
    ratio: { a: R["16/10"], b: R["1/1"], c: R["1/1"], d: R["1/1"], e: R["1/1"] },
  },
  masonry: {
    columns: 2,
    areas: [["a", "b"], ["c", "d"]],
    ratio: { a: R["4/5"], b: R["4/5"], c: R["4/5"], d: R["4/5"] },
  },
  bento4: {
    columns: 2,
    areas: [["a", "b"], ["c", "d"]],
    ratio: { a: R["3/4"], b: R["3/4"], c: R["16/10"], d: R["16/10"] },
  },
  leftCategoryBar1: { columns: 1, areas: [["a"]], ratio: { a: R["16/10"] } },
  rightCategoryBar1: { columns: 1, areas: [["a"]], ratio: { a: R["16/10"] } },
  leftCategoryBar3: {
    columns: 2,
    areas: [["a", "a"], ["b", "c"]],
    ratio: { a: R["16/10"], b: R["1/1"], c: R["1/1"] },
  },
  duo: { columns: 2, areas: [["a", "b"]], ratio: { a: R["1/1"], b: R["1/1"] } },
  trio: {
    columns: 2,
    areas: [["a", "a"], ["b", "c"]],
    ratio: { a: R["16/9"], b: R["1/1"], c: R["1/1"] },
  },
  stackTop: {
    columns: 2,
    areas: [["a", "a"], ["b", "c"]],
    ratio: { a: R["16/9"], b: R["1/1"], c: R["1/1"] },
  },
  quad: {
    columns: 2,
    areas: [["a", "b"], ["c", "d"]],
    ratio: { a: R["1/1"], b: R["1/1"], c: R["1/1"], d: R["1/1"] },
  },
  feature: {
    columns: 2,
    areas: [["a", "b"], ["a", "c"], ["d", "d"], ["e", "e"]],
    ratio: { b: R["4/3"], c: R["4/3"], d: R["5/2"], e: R["4/3"] },
  },
  tallPair: {
    columns: 2,
    areas: [["a", "b"], ["c", "d"], ["e", "e"]],
    ratio: { a: R["3/4"], b: R["3/4"], c: R["4/3"], d: R["4/3"], e: R["5/2"] },
  },
};

/**
 * The 640-767 tier differs from the phone only in two ratios: the stage
 * becomes 16/9 and the bento3 / leftCategoryBar3 promo cells become 4/3.
 * Stated as the overrides the tier applies rather than as whole copies.
 */
const SM_STAGE_RATIO = R["16/9"];
const SM_RATIO_OVERRIDES: Record<string, Record<string, number>> = {
  single: { a: SM_STAGE_RATIO },
  bento2: { a: SM_STAGE_RATIO },
  bento3: { a: SM_STAGE_RATIO, b: R["4/3"], c: R["4/3"] },
  bento5: { a: SM_STAGE_RATIO },
  leftCategoryBar1: { a: SM_STAGE_RATIO },
  rightCategoryBar1: { a: SM_STAGE_RATIO },
  leftCategoryBar3: { a: SM_STAGE_RATIO, b: R["4/3"], c: R["4/3"] },
};

/**
 * The middle tier (768-1023) takes the DESKTOP column tracks with the
 * category rail dropped, but keeps ratios on the cells: a cell that spans
 * rows is released to `auto` and takes its height from the rows it covers,
 * which is why it cannot simply be divided by a ratio of its own.
 *
 * `feature` and `tallPair` are the exception the stylesheet makes: there
 * the ratio sits on the GRID, so the whole box is width/3 and the rows
 * share it.
 */
const MD_GRID_RATIO: Record<string, number> = {
  feature: R["3/1"],
  tallPair: R["3/1"],
};

/** What a cell's own ratio is at the middle tier, when it has one. */
function mdRatio(gridKey: string, area: string): number | undefined {
  const sm = SM_RATIO_OVERRIDES[gridKey]?.[area];
  if (sm) return sm;
  return PHONE_TEMPLATES[gridKey]?.ratio?.[area];
}

/** Which grids hide their category rail below `lg`, and what they collapse to. */
const RAIL_COLLAPSE: Record<string, string> = {
  leftCategoryBar1: "single",
  rightCategoryBar1: "single",
  leftCategoryBar3: "bento3",
};

interface GridCellFrame {
  /** The area letter the cell occupies at this tier. */
  area: string;
  width: number;
  height: number;
  /** False when a value had to be assumed (viewport chrome, content height). */
  exact: boolean;
  /** Why it is not exact, for the label the editor shows. */
  assumption?: string;
}

function round(value: number): number {
  return Math.max(1, Math.round(value));
}

/** The content width of the page at a viewport, before the section's own padding. */
function pageContentWidth(
  viewportWidth: number,
  pageWidth: string,
): number {
  if (pageWidth === "full") return viewportWidth;
  const cap = Number.parseInt(pageWidth, 10);
  return Number.isFinite(cap) ? Math.min(viewportWidth, cap) : viewportWidth;
}

/**
 * The grid box a section draws its cells inside: the page width less the
 * section's own side padding, or the whole viewport for the edge-to-edge
 * widths.
 */
export function gridBoxWidth(options: {
  viewportWidth: number;
  pageWidth: string;
  sliderWidth: string;
  sidePadding: number;
}): number {
  const { viewportWidth, pageWidth, sliderWidth, sidePadding } = options;
  if (sliderWidth === "full" || sliderWidth === "fullHeight") {
    return viewportWidth;
  }
  if (sliderWidth === "fullPadding" || sliderWidth === "fullHeightPadding") {
    return Math.max(1, viewportWidth - sidePadding * 2);
  }
  return Math.max(1, pageContentWidth(viewportWidth, pageWidth) - sidePadding * 2);
}

/** The grid box's height from `lg` up; below that the cells' ratios decide it. */
function gridBoxHeight(options: {
  viewportHeight: number;
  sliderWidth: string;
  sliderHeight: string;
  section: "hero" | "promo";
}): { height: number; exact: boolean; assumption?: string } {
  const { viewportHeight, sliderWidth, sliderHeight, section } = options;
  if (sliderWidth === "fullHeight" || sliderWidth === "fullHeightPadding") {
    return {
      height: Math.max(1, viewportHeight - ASSUMED_CHROME_PX),
      exact: false,
      assumption: "header height is measured in the browser",
    };
  }
  const table = section === "promo" ? PROMO_HEIGHT_SHARE : HERO_HEIGHT_SHARE;
  const share = table[sliderHeight] ?? table.half;
  return {
    height: Math.max(1, Math.round(viewportHeight * share)),
    exact: false,
    assumption: "svh varies with the device's browser chrome",
  };
}

/** The tier a viewport width falls in. */
export function tierFor(viewportWidth: number): "phone" | "sm" | "md" | "lg" {
  if (viewportWidth >= DESKTOP_MIN_WIDTH) return "lg";
  if (viewportWidth >= TABLET_MIN_WIDTH) return "md";
  if (viewportWidth >= 640) return "sm";
  return "phone";
}

/** Track sizes as numbers, from a `grid-template-columns` string of `fr` and `minmax()`. */
function parseTracks(template: string): { fr: number; min: number }[] {
  const tracks: { fr: number; min: number }[] = [];
  // minmax(220px, 1fr) — the floor matters for the category rail column.
  const pattern = /minmax\(\s*(\d+)px\s*,\s*([\d.]+)fr\s*\)|([\d.]+)fr/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template))) {
    if (match[1]) tracks.push({ fr: Number(match[2]), min: Number(match[1]) });
    else tracks.push({ fr: Number(match[3]), min: 0 });
  }
  return tracks;
}

/** Distribute a box across `fr` tracks, honouring any minimum. */
function distribute(total: number, gap: number, tracks: { fr: number; min: number }[]): number[] {
  const free = Math.max(0, total - gap * Math.max(0, tracks.length - 1));
  const totalFr = tracks.reduce((sum, t) => sum + t.fr, 0) || 1;
  // A track with a floor takes it first; the rest share what is left.
  const fixed = tracks.map((t) => (t.min > 0 ? Math.max(t.min, (free * t.fr) / totalFr) : 0));
  const fixedSum = fixed.reduce((sum, n) => sum + n, 0);
  const restFr = tracks.reduce((sum, t, i) => (fixed[i] > 0 ? sum : sum + t.fr), 0) || 1;
  const rest = Math.max(0, free - fixedSum);
  return tracks.map((t, i) => (fixed[i] > 0 ? fixed[i] : (rest * t.fr) / restFr));
}

/** The span of one area in a row-by-row area map: which columns and rows it covers. */
function spanOf(areas: string[][], area: string) {
  let colStart = Infinity;
  let colEnd = -1;
  let rowStart = Infinity;
  let rowEnd = -1;
  areas.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell !== area) return;
      colStart = Math.min(colStart, c);
      colEnd = Math.max(colEnd, c);
      rowStart = Math.min(rowStart, r);
      rowEnd = Math.max(rowEnd, r);
    });
  });
  if (colEnd < 0) return null;
  return { colStart, colEnd, rowStart, rowEnd };
}

/** The desktop area map, parsed from the grid's `areas` string. */
function desktopAreas(areas: string): string[][] {
  return (areas.match(/"[^"]*"/g) ?? []).map((row) =>
    row.replace(/"/g, "").trim().split(/\s+/),
  );
}

/**
 * The frame one cell of a grid occupies at one viewport.
 *
 * `slotIndex` is the cell's position in the section's block list, which is
 * how a slider is bound: `blocks[i]` fills `slots[i]`.
 */
export function cellFrame(options: {
  gridKey: string;
  slotIndex: number;
  section: "hero" | "promo";
  sliderWidth: string;
  sliderHeight: string;
  sidePadding: number;
  gap: number;
  pageWidth: string;
  viewportWidth: number;
  viewportHeight: number;
}): GridCellFrame | null {
  const grid = SLIDER_GRIDS.find((entry) => entry.key === options.gridKey);
  if (!grid) return null;
  const area = grid.slots[options.slotIndex];
  if (!area) return null;

  const tier = tierFor(options.viewportWidth);
  const boxWidth = gridBoxWidth(options);
  // Below lg the gap shrinks to 85%, as `GRID_GAP_CLASS` does.
  const gap = tier === "lg" ? options.gap : Math.round(options.gap * 0.85);

  if (tier === "lg") {
    const box = gridBoxHeight({
      viewportHeight: options.viewportHeight,
      sliderWidth: options.sliderWidth,
      sliderHeight: options.sliderHeight,
      section: options.section,
    });
    const areas = desktopAreas(grid.areas);
    const span = spanOf(areas, area);
    if (!span) return null;
    const cols = distribute(boxWidth, gap, parseTracks(grid.columns));
    const rows = distribute(box.height, gap, parseTracks(grid.rows));
    const width =
      cols.slice(span.colStart, span.colEnd + 1).reduce((sum, n) => sum + n, 0) +
      gap * (span.colEnd - span.colStart);
    const height =
      rows.slice(span.rowStart, span.rowEnd + 1).reduce((sum, n) => sum + n, 0) +
      gap * (span.rowEnd - span.rowStart);
    return {
      area,
      width: round(width),
      height: round(height),
      exact: box.exact,
      assumption: box.assumption,
    };
  }

  // Below lg the rail is hidden and some grids collapse to another's shape.
  const key = tier === "md" ? options.gridKey : (RAIL_COLLAPSE[options.gridKey] ?? options.gridKey);
  const template = PHONE_TEMPLATES[key] ?? PHONE_TEMPLATES[options.gridKey];
  if (!template) return null;

  if (tier === "md") {
    // The desktop tracks with the rail dropped; the section's height classes
    // do not apply here, so the cells' own ratios set the box.
    const railless = grid.category
      ? desktopAreas(grid.areas).map((row) => row.filter((cell) => cell !== grid.category?.area))
      : desktopAreas(grid.areas);
    const span = spanOf(railless, area);
    if (!span) return null;
    const allTracks = parseTracks(grid.columns);
    const tracks = grid.category
      ? grid.category.side === "left"
        ? allTracks.slice(1)
        : allTracks.slice(0, -1)
      : allTracks;
    const cols = distribute(boxWidth, gap, tracks);
    const widthOf = (from: number, to: number) =>
      cols.slice(from, to + 1).reduce((sum, n) => sum + n, 0) + gap * (to - from);
    const width = widthOf(span.colStart, span.colEnd);

    // The whole grid carries the ratio: every row shares that one box.
    const gridRatio = MD_GRID_RATIO[options.gridKey];
    if (gridRatio) {
      const rowCount = railless.length || 1;
      const boxHeight = boxWidth / gridRatio;
      const rowHeight = (boxHeight - gap * (rowCount - 1)) / rowCount;
      const rows = span.rowEnd - span.rowStart + 1;
      return {
        area,
        width: round(width),
        height: round(rowHeight * rows + gap * (rows - 1)),
        exact: true,
      };
    }

    const own = mdRatio(options.gridKey, area);
    if (own) {
      return { area, width: round(width), height: round(width / own), exact: true };
    }

    // No ratio of its own: it spans rows, so its height is theirs. Each row
    // is measured from a neighbour in it that does carry a ratio.
    let height = 0;
    for (let row = span.rowStart; row <= span.rowEnd; row += 1) {
      const neighbours = new Set(railless[row]?.filter((cell) => cell !== area) ?? []);
      let rowHeight = 0;
      for (const cell of neighbours) {
        const ratio = mdRatio(options.gridKey, cell);
        if (!ratio) continue;
        const cellSpan = spanOf(railless, cell);
        if (!cellSpan) continue;
        rowHeight = Math.max(
          rowHeight,
          widthOf(cellSpan.colStart, cellSpan.colEnd) / ratio,
        );
      }
      height += rowHeight || width / SM_STAGE_RATIO;
    }
    height += gap * (span.rowEnd - span.rowStart);
    return { area, width: round(width), height: round(height), exact: true };
  }

  const span = spanOf(template.areas, area);
  if (!span) return null;
  const columns = template.columns;
  const colWidth = (boxWidth - gap * (columns - 1)) / columns;
  const width = colWidth * (span.colEnd - span.colStart + 1) + gap * (span.colEnd - span.colStart);
  const isStage = area === "a" && template.areas[0]?.length === columns && columns > 1;
  const ratio =
    tier === "sm" && isStage
      ? SM_STAGE_RATIO
      : (template.ratio?.[area] ?? SM_STAGE_RATIO);
  // A cell that spans rows takes those rows' heights plus the gap between.
  const rowsSpanned = span.rowEnd - span.rowStart + 1;
  const base = width / ratio;
  const height = template.ratio?.[area] ? base : base * rowsSpanned;
  return { area, width: round(width), height: round(height), exact: true };
}
