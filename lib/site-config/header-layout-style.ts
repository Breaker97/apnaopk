import type { CSSProperties } from "react";
import {
  backgroundAccentColor,
  backgroundCss,
  hasBackground,
} from "@/lib/sliders/types";
import {
  colorTone,
  type ColorTone,
} from "@/lib/site-config/appearance-colors";
import {
  visibleColumns,
  type HeaderAlign,
  type HeaderAlignment,
  type HeaderBackground,
  type HeaderFill,
  type HeaderJustify,
  type HeaderLayoutColumn,
  type HeaderLayoutRow,
  type HeaderPadding,
  type HeaderTextStyle,
} from "@/lib/site-config/header-layout";

/**
 * The layout tree as CSS, shared by the storefront header, the studio
 * preview, the canvas chips and the template cards so all four agree on
 * what a setting means. Pure functions on purpose.
 */

const JUSTIFY_CONTENT: Record<HeaderJustify, CSSProperties["justifyContent"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};

const ALIGN_ITEMS: Record<HeaderAlign, CSSProperties["alignItems"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
};

const TEXT_ALIGN: Record<HeaderAlign, CSSProperties["textAlign"]> = {
  start: "left",
  center: "center",
  end: "right",
};

export function paddingStyle(value: HeaderPadding): CSSProperties {
  return {
    paddingTop: value.top,
    paddingRight: value.right,
    paddingBottom: value.bottom,
    paddingLeft: value.left,
  };
}

/**
 * The type itself — size, weight, case, decoration. The colour is NOT here:
 * a gradient fill paints by clipping a background to the glyphs, which would
 * wipe out the surface's own background if the two shared an element. Spread
 * `fillTextCss(style.fill)` on the text node instead.
 */
export function textStyleCss(style: HeaderTextStyle): CSSProperties {
  return {
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
    textTransform: style.transform === "none" ? undefined : style.transform,
    fontStyle: style.italic ? "italic" : undefined,
    textDecoration: style.underline ? "underline" : undefined,
  };
}

/**
 * A fill on a TEXT node: a colour, or a gradient clipped to the glyphs. The
 * element must own nothing but its text — the clip consumes its background.
 */
export function fillTextCss(fill: HeaderFill): CSSProperties {
  if (!hasBackground(fill)) return {};
  if (fill.type === "solid") return { color: fill.color };
  return {
    ...backgroundCss(fill),
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  };
}

/**
 * A fill on something that cannot clip — an inherited container colour, an
 * icon drawn in `currentColor`. A gradient degrades to its first stop, the
 * same reading an outlined button already takes for its border.
 */
export function fillColorCss(fill: HeaderFill): CSSProperties {
  return { color: backgroundAccentColor(fill) || undefined };
}

export type SurfaceTone = ColorTone;

/** The ink a painted surface reads in, by tone — the default schemes' text. */
export const SURFACE_INK: Record<SurfaceTone, string> = {
  light: "#111827",
  dark: "#ffffff",
};

/**
 * Which way a surface's own paint leans. Null when it has none, when it is
 * a photo, or when it is translucent enough for what sits behind it to
 * decide (see colorTone) — the cases where the ink must keep inheriting.
 */
export function surfaceTone(background: HeaderBackground): SurfaceTone | null {
  return colorTone(backgroundAccentColor(background));
}

/**
 * The ink of a surface that paints its own background. An explicit
 * foreground stands; otherwise the surface's tone picks it — dark text on
 * a light paint, light on a dark one. The bar's own foreground follows the
 * shopper's theme, so a row or a search pill painted white would otherwise
 * inherit white text the moment the store goes dark. A surface with no
 * paint of its own chooses nothing and keeps inheriting.
 */
export function surfaceInkCss(
  background: HeaderBackground,
  foreground?: HeaderFill,
): CSSProperties {
  if (foreground && hasBackground(foreground)) return fillColorCss(foreground);
  const tone = surfaceTone(background);
  return tone ? { color: SURFACE_INK[tone] } : {};
}

/**
 * A painted row is a surface of its own: its ink (see surfaceInkCss), and
 * the tokens the panels it drops — a nav dropdown, search suggestions —
 * paint themselves with, so they match the row rather than the bar behind
 * it. A row with no opaque paint of its own hands both to the bar.
 */
export function rowSurfaceCss(row: HeaderLayoutRow): CSSProperties {
  const ink = surfaceInkCss(row.background, row.foreground);
  const tone = surfaceTone(row.background);
  if (!tone || !ink.color) return ink;
  const paint = backgroundAccentColor(row.background);
  return {
    ...ink,
    "--background": paint,
    "--foreground": ink.color,
    "--muted-foreground": ink.color,
    "--popover": paint,
    "--popover-foreground": ink.color,
  } as CSSProperties;
}

/** The row's frosted-glass blur, when it has one. */
export function rowBlurCss(row: HeaderLayoutRow): CSSProperties {
  if (!row.blur) return {};
  return {
    backdropFilter: `blur(${row.blur}px)`,
    WebkitBackdropFilter: `blur(${row.blur}px)`,
  };
}

/**
 * A row is a grid of `fr` tracks. Its vertical alignment places the columns
 * in the row's height. Its horizontal alignment is NOT a grid property: a
 * column always fills its track — that is what its `width` share means —
 * and the row's horizontal alignment is the placement every column falls
 * back to for its own content (see columnStyle). The tracks themselves
 * always fill the row, so a justify-content here would never show.
 *
 * A track's floor is its content (`auto`, not 0): a column given too small
 * a share for its icons keeps the room they need and the others split the
 * rest, rather than its content spilling over the neighbour's — which a
 * search bar filling its own column would otherwise sit under.
 */
export function rowGridStyle(row: HeaderLayoutRow): CSSProperties {
  const columns = visibleColumns(row);
  return {
    display: "grid",
    gridTemplateColumns: columns
      .map((column) => `minmax(auto, ${column.width}fr)`)
      .join(" "),
    alignItems: ALIGN_ITEMS[row.align.vertical],
    columnGap: row.gap,
    minHeight: row.height || undefined,
  };
}

/** The row's grid and its paint together — the preview's whole row. */
export function rowStyle(row: HeaderLayoutRow): CSSProperties {
  return {
    ...rowGridStyle(row),
    ...(row.borderBottom
      ? {
          borderBottom: `${row.borderBottom}px solid ${row.borderColor || "currentColor"}`,
        }
      : {}),
    ...rowBlurCss(row),
    ...backgroundCss(row.background),
    ...rowSurfaceCss(row),
  };
}

/**
 * Where a column's content sits along it: its own horizontal alignment,
 * or the row's when the column is at its "start" default.
 */
function columnHorizontal(
  column: HeaderLayoutColumn,
  row?: Pick<HeaderLayoutRow, "align">,
): HeaderAlign {
  if (column.align.horizontal !== "start") return column.align.horizontal;
  return row?.align.horizontal ?? "start";
}

/**
 * A column is a flex row of items that always fills its track — the track
 * IS the column's width share, and an item that fills its column (a search
 * bar, an All Categories button at width 0) needs the whole of it. So the
 * horizontal alignment never shrinks the column; like a nav's (see
 * navJustifyContent) it places the items as a group and wins whenever
 * `justify` is at its "start" default, and the row's alignment stands in
 * when the column's own is. Vertically, "center" follows the row and
 * start/end override it; the items sit across the column's own height
 * when it has one.
 */
export function columnStyle(
  column: HeaderLayoutColumn,
  row?: Pick<HeaderLayoutRow, "align">,
): CSSProperties {
  const horizontal = columnHorizontal(column, row);
  return {
    display: "flex",
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: column.gap,
    justifyContent:
      column.justify === "start" && horizontal !== "start"
        ? ALIGN_ITEMS[horizontal]
        : JUSTIFY_CONTENT[column.justify],
    alignItems: ALIGN_ITEMS[column.align.vertical],
    alignSelf:
      column.align.vertical === "center"
        ? undefined
        : ALIGN_ITEMS[column.align.vertical],
    textAlign: TEXT_ALIGN[horizontal],
    minHeight: column.height || undefined,
  };
}

/**
 * Where a nav's links sit along it. Justify distributes them; the
 * horizontal alignment places them as a group, and wins whenever Justify
 * is at its "start" default — the one case where the two would otherwise
 * say the same thing.
 */
export function navJustifyContent(nav: {
  justify: HeaderJustify;
  align: HeaderAlignment;
}): CSSProperties["justifyContent"] {
  return nav.justify === "start" && nav.align.horizontal !== "start"
    ? ALIGN_ITEMS[nav.align.horizontal]
    : JUSTIFY_CONTENT[nav.justify];
}

export function alignItemsValue(align: HeaderAlign) {
  return ALIGN_ITEMS[align];
}

export function justifyContentValue(align: HeaderAlign) {
  return JUSTIFY_CONTENT[align];
}

export function textAlignValue(align: HeaderAlign) {
  return TEXT_ALIGN[align];
}

