import { backgroundAccentColor, hasBackground } from "@/lib/sliders/types";
import {
  colorChroma,
  colorTone,
  contrastRatio,
  normalizeColorToHex,
} from "@/lib/site-config/appearance-colors";
import {
  inheritFill,
  solidBackground,
  type HeaderBackground,
  type HeaderFill,
  type HeaderLayout,
  type HeaderLayoutItem,
  type HeaderLayoutRow,
  type HeaderTextStyle,
} from "@/lib/site-config/header-layout";

/**
 * The layout tree as the dark scheme paints it.
 *
 * Header Studio paints are one colour each, drawn in a studio that renders
 * light. A row painted white or a search pill painted #f3f3f3 is the light
 * theme's surface, not a wish for a white strip across a dark store — so
 * when the shopper's theme is dark, the scheme the merchant set for it
 * (Header → Colors → Dark) takes those surfaces over:
 *
 * - a NEUTRAL LIGHT paint — white, grey, a faint tint (isNeutralLight) —
 *   becomes the scheme's surface: the bar colour for rows and panels, the
 *   search colour for anything raised on the bar (a pill, a button, a
 *   plate), each with the scheme's matching ink;
 * - a coloured or dark paint stands, ink and all: a brand-blue button or a
 *   yellow promo strip reads the same in either theme;
 * - an ink that no longer reads on what is now beneath it (under 3:1, the
 *   WCAG floor for UI text) clears to the surface's own ink.
 *
 * Pure, and applied at render time only: the stored layout is never touched,
 * and the light theme renders exactly what the studio drew.
 */

/** The merchant's dark scheme — `HeaderSettings["colors"]["dark"]`. */
export interface HeaderSchemeColors {
  backgroundColor: string;
  textColor: string;
  searchBackgroundColor: string;
  searchTextColor: string;
}

/** Chroma (max − min channel, of 255) up to which a paint reads as grey. */
const NEUTRAL_CHROMA = 40;
/** The contrast an ink must keep on its surface to survive the scheme. */
const MIN_INK_CONTRAST = 3;

/** The scheme's two surfaces, each with its ink. */
interface Surfaces {
  base: string;
  baseInk: string;
  raised: string;
  raisedInk: string;
}

/** The colour a paint amounts to, when it has one — none for a photo. */
function paintColor(paint: HeaderBackground): string | null {
  return normalizeColorToHex(backgroundAccentColor(paint));
}

/** White, grey, a faint tint: a surface drawn for the light theme. */
function isNeutralLight(paint: HeaderBackground): boolean {
  const color = paintColor(paint);
  if (!color) return false;
  const chroma = colorChroma(color);
  return (
    colorTone(color) === "light" && chroma !== null && chroma <= NEUTRAL_CHROMA
  );
}

/** What lies beneath: the paint's own colour, else the surface it sits on. */
function beneath(
  paint: HeaderBackground,
  surface: string | null,
): string | null {
  return hasBackground(paint) ? paintColor(paint) : surface;
}

/** A neutral light paint becomes the scheme's surface; anything else stands. */
function resurface(paint: HeaderBackground, to: string): HeaderBackground {
  return isNeutralLight(paint) ? solidBackground(to) : paint;
}

/** An ink that no longer reads on `surface` clears to the surface's own. */
function readableInk(ink: HeaderFill, surface: string | null): HeaderFill {
  if (!surface || !hasBackground(ink)) return ink;
  const color = paintColor(ink);
  if (!color) return ink;
  return contrastRatio(color, surface) >= MIN_INK_CONTRAST
    ? ink
    : inheritFill();
}

function readableText(
  style: HeaderTextStyle,
  surface: string | null,
): HeaderTextStyle {
  const fill = readableInk(style.fill, surface);
  return fill === style.fill ? style : { ...style, fill };
}

/**
 * A plate and the ink on it. Resurfaced, the plate takes the scheme's ink
 * outright — its old ink was drawn for the light plate; kept, its ink stays
 * as long as it still reads.
 */
function replate(
  background: HeaderBackground,
  foreground: HeaderFill,
  surface: string | null,
  to: { plate: string; ink: string },
): { background: HeaderBackground; foreground: HeaderFill; under: string | null } {
  if (isNeutralLight(background)) {
    return {
      background: solidBackground(to.plate),
      foreground: solidBackground(to.ink),
      under: to.plate,
    };
  }
  const under = beneath(background, surface);
  return { background, foreground: readableInk(foreground, under), under };
}

function darkenItem(
  item: HeaderLayoutItem,
  surface: string | null,
  s: Surfaces,
): HeaderLayoutItem {
  const raised = { plate: s.raised, ink: s.raisedInk };
  switch (item.type) {
    case "brand":
      return item;

    case "nav": {
      const background = resurface(item.background, s.base);
      return {
        ...item,
        background,
        textStyle: readableText(item.textStyle, beneath(background, surface)),
      };
    }

    case "collections":
      return { ...item, textStyle: readableText(item.textStyle, surface) };

    case "searchBar": {
      const plate = replate(item.background, item.foreground, surface, raised);
      return {
        ...item,
        background: plate.background,
        foreground: plate.foreground,
        textStyle: readableText(item.textStyle, plate.under),
      };
    }

    case "searchIcon": {
      const pillBackground = resurface(item.pillBackground, s.raised);
      const inPill =
        item.style === "pill" ? beneath(pillBackground, surface) : surface;
      const plate = replate(item.background, item.foreground, inPill, raised);
      return {
        ...item,
        pillBackground,
        background: plate.background,
        foreground: plate.foreground,
      };
    }

    case "categories": {
      const plate = replate(item.background, item.foreground, surface, raised);
      // The panel drops over the page, whose dark surface the bar's stands
      // in for; a light panel becomes a bar-coloured card with the search
      // colour as its raised highlight.
      const panel = replate(item.panel.background, item.panel.foreground, s.base, {
        plate: s.base,
        ink: s.baseInk,
      });
      return {
        ...item,
        background: plate.background,
        foreground: plate.foreground,
        textStyle: readableText(item.textStyle, plate.under),
        panel: {
          ...item.panel,
          background: panel.background,
          foreground: panel.foreground,
          highlight: resurface(item.panel.highlight, s.raised),
        },
      };
    }

    case "buttons": {
      const background = resurface(item.background, s.raised);
      // A solid button with no plate of its own paints the theme primary,
      // which the scheme does not know — its label is left alone.
      const under =
        item.variant === "solid"
          ? hasBackground(background)
            ? beneath(background, surface)
            : null
          : surface;
      return { ...item, background, textStyle: readableText(item.textStyle, under) };
    }

    case "text": {
      const background = resurface(item.background, s.raised);
      return {
        ...item,
        background,
        textStyle: readableText(item.textStyle, beneath(background, surface)),
      };
    }

    case "menuButton": {
      const plate = replate(item.background, item.foreground, surface, raised);
      return { ...item, background: plate.background, foreground: plate.foreground };
    }

    case "icons":
    case "user":
    case "location":
      return { ...item, foreground: readableInk(item.foreground, surface) };
  }
}

function darkenRow(row: HeaderLayoutRow, s: Surfaces): HeaderLayoutRow {
  const plate = replate(row.background, row.foreground, s.base, {
    plate: s.base,
    ink: s.baseInk,
  });
  // Beneath the row's items: its own paint, else the bar — the scheme's.
  const surface = plate.under;
  return {
    ...row,
    background: plate.background,
    foreground: plate.foreground,
    columns: row.columns.map((column) => ({
      ...column,
      items: column.items.map((item) => darkenItem(item, surface, s)),
    })),
  };
}

/** A scheme colour, or the shipped dark default when it is not one. */
function colorOr(value: string, fallback: string): string {
  return normalizeColorToHex(value) ?? fallback;
}

/**
 * The tree the storefront renders while the shopper's theme is dark — see
 * the module comment. Returns a new tree; ids and structure are unchanged,
 * so everything keyed on them (folding rows, the location slot, the brand
 * scale) reads the same.
 */
export function darkenHeaderLayout(
  layout: HeaderLayout,
  scheme: HeaderSchemeColors,
): HeaderLayout {
  const s: Surfaces = {
    base: colorOr(scheme.backgroundColor, "#050505"),
    baseInk: colorOr(scheme.textColor, "#ffffff"),
    raised: colorOr(scheme.searchBackgroundColor, "#111111"),
    raisedInk: colorOr(scheme.searchTextColor, "#ffffff"),
  };
  return { ...layout, rows: layout.rows.map((row) => darkenRow(row, s)) };
}
