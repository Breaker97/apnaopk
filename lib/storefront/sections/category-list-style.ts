/**
 * The Category List block's look, as data: layout, tile, image, text,
 * title, arrows, hover and links. One renderer (`CategoryTiles`) draws every
 * combination; the block's three templates are presets of these values, so
 * a merchant starts from a design and adjusts anything about it.
 *
 * Stored as a JSON string in the section's `style` text field holding only
 * what the merchant changed; every other key comes from the active
 * template's preset. A block saved before this existed has no `style` and
 * renders its template exactly as it always did.
 *
 * This module must stay CLIENT-SAFE and pure (no server imports): the admin
 * editor reads it for its live preview.
 */

export interface CategoryTile {
  id: string;
  name: string;
  slug: string;
  image?: string;
}

/** `auto`: a grid until there are more tiles than columns, then a carousel. */
export const CATEGORY_LAYOUTS = ["auto", "grid", "carousel"] as const;
export type CategoryLayout = (typeof CATEGORY_LAYOUTS)[number];

/** Phones: a single swipeable row, or the grid wrapped to `mobileColumns`. */
export const CATEGORY_MOBILE_LAYOUTS = ["scroll", "grid"] as const;
export type CategoryMobileLayout = (typeof CATEGORY_MOBILE_LAYOUTS)[number];

/** Where a row shorter than its width sits. */
export const CATEGORY_ROW_ALIGNS = ["left", "center"] as const;
export type CategoryRowAlign = (typeof CATEGORY_ROW_ALIGNS)[number];

export const CATEGORY_SHAPES = [
  "circle",
  "square",
  "portrait",
  "tall",
  "landscape",
  "wide",
] as const;
export type CategoryShape = (typeof CATEGORY_SHAPES)[number];

/** CSS `aspect-ratio` per shape; a fixed tile height overrides it. */
export const CATEGORY_SHAPE_RATIOS: Record<CategoryShape, string> = {
  circle: "1 / 1",
  square: "1 / 1",
  portrait: "4 / 5",
  tall: "2 / 3",
  landscape: "4 / 3",
  wide: "16 / 9",
};

export const CATEGORY_IMAGE_FITS = ["cover", "contain"] as const;
export type CategoryImageFit = (typeof CATEGORY_IMAGE_FITS)[number];

/** What a category with no picture shows in its tile. */
export const CATEGORY_PLACEHOLDERS = ["monogram", "icon", "none"] as const;
export type CategoryPlaceholder = (typeof CATEGORY_PLACEHOLDERS)[number];

export const CATEGORY_TEXT_POSITIONS = ["below", "above", "over"] as const;
export type CategoryTextPosition = (typeof CATEGORY_TEXT_POSITIONS)[number];

export const CATEGORY_TEXT_ALIGNS = ["left", "center", "right"] as const;
export type CategoryTextAlign = (typeof CATEGORY_TEXT_ALIGNS)[number];

/** Where text sits when it is over the picture. */
export const CATEGORY_TEXT_VERTICALS = ["top", "center", "bottom"] as const;
export type CategoryTextVertical = (typeof CATEGORY_TEXT_VERTICALS)[number];

export const CATEGORY_TEXT_WEIGHTS = ["400", "500", "600", "700"] as const;
export type CategoryTextWeight = (typeof CATEGORY_TEXT_WEIGHTS)[number];

export const CATEGORY_TEXT_CASES = ["none", "uppercase"] as const;
export type CategoryTextCase = (typeof CATEGORY_TEXT_CASES)[number];

export const CATEGORY_TITLE_STYLES = ["plain", "twoTone"] as const;
export type CategoryTitleStyle = (typeof CATEGORY_TITLE_STYLES)[number];

export const CATEGORY_TITLE_ALIGNS = ["left", "center"] as const;
export type CategoryTitleAlign = (typeof CATEGORY_TITLE_ALIGNS)[number];

export const CATEGORY_ARROW_STYLES = ["circle", "square", "plain", "hidden"] as const;
export type CategoryArrowStyle = (typeof CATEGORY_ARROW_STYLES)[number];

/** Flanking the row, or in the title row at the far end. */
export const CATEGORY_ARROW_POSITIONS = ["sides", "top"] as const;
export type CategoryArrowPosition = (typeof CATEGORY_ARROW_POSITIONS)[number];

export const CATEGORY_HOVERS = ["zoom", "lift", "fade", "darken", "none"] as const;
export type CategoryHover = (typeof CATEGORY_HOVERS)[number];

/** Where a tile leads: the listing filtered to the category, or its own page. */
export const CATEGORY_LINK_TARGETS = ["listing", "category"] as const;
export type CategoryLinkTarget = (typeof CATEGORY_LINK_TARGETS)[number];

export interface CategoryListStyle {
  // Layout
  layout: CategoryLayout;
  /** Tiles per row on desktop (and, for a carousel with no tile width, visible tiles). */
  columns: number;
  /** Tiles per row on tablets. */
  tabletColumns: number;
  /** Tiles across on phones: visible in a scroll row, or per row in a grid. */
  mobileColumns: number;
  mobileLayout: CategoryMobileLayout;
  /** Where a row that does not fill its width sits. */
  align: CategoryRowAlign;
  /** px between tiles, desktop / phones. */
  gap: number;
  mobileGap: number;

  // Tile
  shape: CategoryShape;
  /** px; a circle ignores it. 999 is fully round. */
  roundness: number;
  /** px; 0 = as wide as its column. Carousels only. */
  tileWidth: number;
  /** px; 0 = from the shape. */
  tileHeight: number;
  /** CSS color or `var(--token)`; "" = none. */
  tileBackground: string;
  tileBorder: string;
  tileBorderWidth: number;
  /** Drop-shadow softness (px blur); 0 = none. */
  tileShadow: number;

  // Image
  imageFit: CategoryImageFit;
  /** Air around a contained picture (px). */
  imagePadding: number;
  placeholder: CategoryPlaceholder;

  // Text
  showText: boolean;
  textPosition: CategoryTextPosition;
  textAlign: CategoryTextAlign;
  textVertical: CategoryTextVertical;
  /** px, desktop; phones scale it down. */
  textSize: number;
  textWeight: CategoryTextWeight;
  textCase: CategoryTextCase;
  /** "" = the theme's text, or white over a picture. */
  textColor: string;
  /** px between the text and the tile (below/above), or its inset (over). */
  textGap: number;
  /** Darkening under text over a picture, 0–80 (%). */
  overlay: number;

  // Title
  titleStyle: CategoryTitleStyle;
  titleAlign: CategoryTitleAlign;

  // Arrows (carousels)
  arrows: CategoryArrowStyle;
  arrowPosition: CategoryArrowPosition;
  /** px. */
  arrowSize: number;

  // Behaviour
  hover: CategoryHover;
  linkTo: CategoryLinkTarget;
}

export const CATEGORY_LIST_VARIANTS = ["cards", "circles", "overlay"] as const;
export type CategoryListVariant = (typeof CATEGORY_LIST_VARIANTS)[number];

/** The original image-card row: small pictures in a bare frame, names beneath. */
const CARDS: CategoryListStyle = {
  layout: "auto",
  columns: 8,
  tabletColumns: 6,
  mobileColumns: 4,
  mobileLayout: "scroll",
  align: "left",
  gap: 24,
  mobileGap: 12,
  shape: "square",
  roundness: 0,
  tileWidth: 0,
  tileHeight: 100,
  tileBackground: "",
  tileBorder: "",
  tileBorderWidth: 0,
  tileShadow: 0,
  imageFit: "contain",
  imagePadding: 0,
  placeholder: "monogram",
  showText: true,
  textPosition: "below",
  textAlign: "center",
  textVertical: "bottom",
  textSize: 14,
  textWeight: "700",
  textCase: "none",
  textColor: "",
  textGap: 12,
  overlay: 0,
  titleStyle: "plain",
  titleAlign: "left",
  arrows: "square",
  arrowPosition: "top",
  arrowSize: 36,
  hover: "zoom",
  linkTo: "listing",
};

/** Circular department tiles between round arrows, under a centred two-tone heading. */
const CIRCLES: CategoryListStyle = {
  ...CARDS,
  layout: "carousel",
  columns: 6,
  tabletColumns: 5,
  mobileColumns: 4,
  align: "center",
  gap: 38,
  mobileGap: 20,
  shape: "circle",
  roundness: 999,
  tileWidth: 152,
  tileHeight: 0,
  tileBackground: "var(--muted)",
  imageFit: "contain",
  imagePadding: 28,
  placeholder: "icon",
  textSize: 16,
  textGap: 15,
  titleStyle: "twoTone",
  titleAlign: "center",
  arrows: "circle",
  arrowPosition: "sides",
  arrowSize: 40,
  linkTo: "category",
};

/** Tall picture tiles with the name on the picture — the fashion design. */
const OVERLAY: CategoryListStyle = {
  ...CARDS,
  layout: "grid",
  columns: 4,
  tabletColumns: 3,
  mobileColumns: 1,
  gap: 16,
  mobileGap: 12,
  shape: "portrait",
  roundness: 16,
  tileHeight: 0,
  tileBackground: "var(--muted)",
  imageFit: "cover",
  placeholder: "none",
  textPosition: "over",
  textVertical: "center",
  textSize: 24,
  textGap: 16,
  overlay: 45,
  titleAlign: "center",
  arrows: "hidden",
};

export const CATEGORY_LIST_PRESETS: Record<CategoryListVariant, CategoryListStyle> = {
  cards: CARDS,
  circles: CIRCLES,
  overlay: OVERLAY,
};

export const CATEGORY_STYLE_LIMITS = {
  columns: { min: 2, max: 8 },
  tabletColumns: { min: 2, max: 6 },
  mobileColumns: { min: 1, max: 4 },
  gap: { min: 0, max: 80 },
  mobileGap: { min: 0, max: 40 },
  roundness: { min: 0, max: 999 },
  tileWidth: { min: 0, max: 600 },
  tileHeight: { min: 0, max: 800 },
  tileBorderWidth: { min: 0, max: 8 },
  tileShadow: { min: 0, max: 60 },
  imagePadding: { min: 0, max: 80 },
  textSize: { min: 10, max: 48 },
  textGap: { min: 0, max: 48 },
  overlay: { min: 0, max: 80 },
  arrowSize: { min: 24, max: 64 },
} as const;

type NumberKey = keyof typeof CATEGORY_STYLE_LIMITS;

const SELECTS: { [K in keyof CategoryListStyle]?: readonly string[] } = {
  layout: CATEGORY_LAYOUTS,
  mobileLayout: CATEGORY_MOBILE_LAYOUTS,
  align: CATEGORY_ROW_ALIGNS,
  shape: CATEGORY_SHAPES,
  imageFit: CATEGORY_IMAGE_FITS,
  placeholder: CATEGORY_PLACEHOLDERS,
  textPosition: CATEGORY_TEXT_POSITIONS,
  textAlign: CATEGORY_TEXT_ALIGNS,
  textVertical: CATEGORY_TEXT_VERTICALS,
  textWeight: CATEGORY_TEXT_WEIGHTS,
  textCase: CATEGORY_TEXT_CASES,
  titleStyle: CATEGORY_TITLE_STYLES,
  titleAlign: CATEGORY_TITLE_ALIGNS,
  arrows: CATEGORY_ARROW_STYLES,
  arrowPosition: CATEGORY_ARROW_POSITIONS,
  hover: CATEGORY_HOVERS,
  linkTo: CATEGORY_LINK_TARGETS,
};

const COLOR_KEYS = ["tileBackground", "tileBorder", "textColor"] as const;

/** A hex, or a theme token reference — never arbitrary CSS. */
const COLOR_RE = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|var\(--[a-z0-9-]+\))$/i;

function resolveCategoryListVariant(value: unknown): CategoryListVariant {
  return typeof value === "string" &&
    (CATEGORY_LIST_VARIANTS as readonly string[]).includes(value)
    ? (value as CategoryListVariant)
    : "cards";
}

function parseStored(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The stored overrides on top of the template's preset. Every value is
 * validated against its vocabulary or bounds; anything off falls back to
 * the preset, key by key.
 */
export function readCategoryListStyle(
  raw: unknown,
  variant: unknown,
): CategoryListStyle {
  const preset = CATEGORY_LIST_PRESETS[resolveCategoryListVariant(variant)];
  const stored = parseStored(raw);
  const style: CategoryListStyle = { ...preset };

  for (const key of Object.keys(CATEGORY_STYLE_LIMITS) as NumberKey[]) {
    const value = stored[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      const { min, max } = CATEGORY_STYLE_LIMITS[key];
      style[key] = Math.min(max, Math.max(min, Math.round(value)));
    }
  }
  for (const [key, options] of Object.entries(SELECTS) as [
    keyof CategoryListStyle,
    readonly string[],
  ][]) {
    const value = stored[key];
    if (typeof value === "string" && options.includes(value)) {
      (style as unknown as Record<string, unknown>)[key] = value;
    }
  }
  for (const key of COLOR_KEYS) {
    const value = stored[key];
    if (typeof value === "string" && (value === "" || COLOR_RE.test(value.trim()))) {
      style[key] = value.trim();
    }
  }
  if (typeof stored.showText === "boolean") style.showText = stored.showText;

  return style;
}

/**
 * What to store: only the keys that differ from the template's preset, so
 * a template's own values are never frozen into the document and a later
 * refinement of a preset reaches every block that did not override it.
 * "" when nothing differs, which is also what a fresh block holds.
 */
export function serializeCategoryListStyle(
  style: CategoryListStyle,
  variant: unknown,
): string {
  const preset = CATEGORY_LIST_PRESETS[resolveCategoryListVariant(variant)];
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(preset) as (keyof CategoryListStyle)[]) {
    if (style[key] !== preset[key]) diff[key] = style[key];
  }
  return Object.keys(diff).length > 0 ? JSON.stringify(diff) : "";
}

/** Whether a block has any styling of its own beyond its template. */
export function hasCategoryListStyleOverrides(raw: unknown): boolean {
  return Object.keys(parseStored(raw)).length > 0;
}

// ---- Derived geometry (shared by the renderer and its tests) ---------------

/** Phones draw everything a little smaller; these are the factors. */
export const CATEGORY_MOBILE_SCALE = { tile: 0.64, text: 0.8, width: 0.55 } as const;
export const CATEGORY_TABLET_WIDTH_SCALE = 0.87;

/**
 * Whether the desktop row scrolls sideways (with arrows) rather than
 * wrapping into a grid.
 */
export function categoryRowScrolls(style: CategoryListStyle, count: number): boolean {
  if (style.layout === "carousel") return true;
  if (style.layout === "grid") return false;
  return count > style.columns;
}

/**
 * A scroll-row tile's flex basis: a fixed width where one is set, else the
 * share of the row `visible` tiles take — a fraction over, so the next tile
 * peeks in and says the row continues.
 */
export function categoryTileBasis(
  tileWidth: number,
  visible: number,
  gap: number,
  peek: boolean,
): string {
  if (tileWidth > 0) return `${tileWidth}px`;
  const tiles = peek ? visible + 0.4 : visible;
  return `calc((100% - ${gap}px * ${Math.max(0, visible - 1)}) / ${tiles})`;
}

export function categoryTileHref(
  locale: string,
  slug: string,
  linkTo: CategoryLinkTarget,
): string {
  return linkTo === "category"
    ? `/${locale}/categories/${encodeURIComponent(slug)}`
    : `/${locale}/products?category=${encodeURIComponent(slug)}`;
}
