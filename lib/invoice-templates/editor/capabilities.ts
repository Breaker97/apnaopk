/**
 * The capability map (docs/INVOICE_TEMPLATE_BUILDER.md §5.6): which property
 * sections the right panel shows for each element type, and which controls
 * inside Typography, Colours and Border & spacing. The panel renders exactly
 * what this says; nothing else decides what a type can change.
 *
 * It follows what the renderer actually reads, so a control never promises
 * something the print ignores: a barcode's bars are always black, so it has no
 * text colour; a rule's thickness, style and colour are its border settings
 * (P1 seam); a product table's cells align by column, so it has no alignment.
 *
 * In v1 only `text` reads a binding (P1 seam), so only `text` has Content.
 * The other elements take what they show from `config`: that is the `config`
 * section (a block's fields, columns, rows, source …), and a repeating block's
 * page-flow settings are the `flow` section. `text` and `box` have no config.
 *
 * Pure and client-safe.
 */
import type { ElementType } from "../types";

/** In the order they appear in the panel. `header` and `position` are always there. */
export const PROPERTY_SECTIONS = [
  "header",
  "content",
  "config",
  "position",
  "flow",
  "typography",
  "colours",
  "border",
  "format",
  "stylePreset",
] as const;
export type PropertySection = (typeof PROPERTY_SECTIONS)[number];

export const TYPOGRAPHY_CONTROLS = [
  "fontFamily",
  "fontSizePx",
  "fontWeight",
  "fontStyle",
  "textAlign",
  "lineHeight",
  "verticalAlign",
  "shrinkToFit",
] as const;
export type TypographyControl = (typeof TYPOGRAPHY_CONTROLS)[number];

export const COLOUR_CONTROLS = ["color", "background"] as const;
export type ColourControl = (typeof COLOUR_CONTROLS)[number];

export const BORDER_CONTROLS = ["borderWidthPx", "borderStyle", "borderColor", "radiusPx", "paddingMm", "gapMm"] as const;
export type BorderControl = (typeof BORDER_CONTROLS)[number];

export interface Capabilities {
  sections: readonly PropertySection[];
  typography: readonly TypographyControl[];
  colours: readonly ColourControl[];
  border: readonly BorderControl[];
}

const ALL_TEXT: readonly TypographyControl[] = TYPOGRAPHY_CONTROLS;
const KEY_VALUE_TEXT: readonly TypographyControl[] = ["fontFamily", "fontSizePx", "fontWeight", "fontStyle", "lineHeight", "verticalAlign", "shrinkToFit"];
const TABLE_TEXT: readonly TypographyControl[] = ["fontFamily", "fontSizePx", "fontWeight", "fontStyle", "lineHeight"];
const ROWS_TEXT: readonly TypographyControl[] = ["fontFamily", "fontSizePx", "fontWeight", "fontStyle", "textAlign", "lineHeight"];

const FRAME: readonly BorderControl[] = ["borderWidthPx", "borderStyle", "borderColor", "radiusPx", "paddingMm"];
const FRAME_AND_GAP: readonly BorderControl[] = [...FRAME, "gapMm"];

const TEXT_SECTIONS: readonly PropertySection[] = ["header", "content", "position", "typography", "colours", "border", "format", "stylePreset"];
const BLOCK_SECTIONS: readonly PropertySection[] = ["header", "position", "typography", "colours", "border", "stylePreset"];
const BLOCK_SECTIONS_WITH_FORMAT: readonly PropertySection[] = ["header", "position", "typography", "colours", "border", "format", "stylePreset"];
const FLOWING_SECTIONS: readonly PropertySection[] = ["header", "position", "flow", "typography", "colours", "border", "format", "stylePreset"];
const PICTURE_SECTIONS: readonly PropertySection[] = ["header", "position", "colours", "border"];

/** The only types without block settings: a text reads a binding, a box is just a frame. */
const NO_CONFIG: readonly ElementType[] = ["text", "box"];

/** A section list with `config` right after the header (and Content) for a type that has settings. */
function withConfigSection(type: ElementType, sections: readonly PropertySection[]): readonly PropertySection[] {
  if (NO_CONFIG.includes(type)) return sections;
  const at = sections.includes("content") ? sections.indexOf("content") + 1 : 1;
  return [...sections.slice(0, at), "config", ...sections.slice(at)];
}

const CAPABILITIES: Record<ElementType, Capabilities> = {
  text: { sections: TEXT_SECTIONS, typography: ALL_TEXT, colours: ["color", "background"], border: FRAME },
  image: { sections: PICTURE_SECTIONS, typography: [], colours: ["background"], border: FRAME },
  barcode: { sections: PICTURE_SECTIONS, typography: [], colours: ["background"], border: FRAME },
  qr: { sections: PICTURE_SECTIONS, typography: [], colours: ["background"], border: FRAME },
  line: { sections: ["header", "position", "border"], typography: [], colours: [], border: ["borderWidthPx", "borderStyle", "borderColor"] },
  box: { sections: ["header", "position", "colours", "border"], typography: [], colours: ["background"], border: ["borderWidthPx", "borderStyle", "borderColor", "radiusPx"] },
  businessHeader: { sections: BLOCK_SECTIONS, typography: ALL_TEXT, colours: ["color", "background"], border: FRAME_AND_GAP },
  customerAddress: { sections: BLOCK_SECTIONS, typography: ALL_TEXT, colours: ["color", "background"], border: FRAME },
  orderSummary: { sections: BLOCK_SECTIONS_WITH_FORMAT, typography: KEY_VALUE_TEXT, colours: ["color", "background"], border: FRAME_AND_GAP },
  productTable: { sections: FLOWING_SECTIONS, typography: TABLE_TEXT, colours: ["color", "background"], border: FRAME },
  productRows: { sections: FLOWING_SECTIONS, typography: ROWS_TEXT, colours: ["color", "background"], border: FRAME_AND_GAP },
  priceSummary: { sections: BLOCK_SECTIONS_WITH_FORMAT, typography: KEY_VALUE_TEXT, colours: ["color", "background"], border: FRAME_AND_GAP },
  codBadge: { sections: BLOCK_SECTIONS_WITH_FORMAT, typography: ALL_TEXT, colours: ["color", "background"], border: FRAME },
  deliveryMethod: { sections: BLOCK_SECTIONS, typography: ALL_TEXT, colours: ["color", "background"], border: FRAME_AND_GAP },
  notes: { sections: BLOCK_SECTIONS, typography: ALL_TEXT, colours: ["color", "background"], border: FRAME },
};

export function capabilitiesFor(type: ElementType): Capabilities {
  const capabilities = CAPABILITIES[type];
  return { ...capabilities, sections: withConfigSection(type, capabilities.sections) };
}

export function sectionsFor(type: ElementType): readonly PropertySection[] {
  return capabilitiesFor(type).sections;
}

export function hasSection(type: ElementType, section: PropertySection): boolean {
  return sectionsFor(type).includes(section);
}
