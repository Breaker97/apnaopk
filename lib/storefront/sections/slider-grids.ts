import type { BlockInstance, Field, SectionInstance } from "./types";

/**
 * The Hero Slider's layout vocabulary — shared by the storefront renderer,
 * the admin studio, and the setup panels in the section picker, so all three
 * always agree on what a grid key means.
 *
 * This module must stay CLIENT-SAFE and pure (no server imports): the admin
 * bundles it into the picker wizard and the studio, while the slideshow
 * definition uses it on the server.
 *
 * The responsive CSS for these grids lives in `app/globals.css` under the
 * `.hs-grid--<key>` rules — keep both in sync when a grid changes.
 */

export interface SliderGrid {
  key: string;
  /** English fallback; the UI looks up `admin.storeBuilder.sliderBlock.grids.<key>` first. */
  label: string;
  /** CSS grid-template-columns / rows / areas for the desktop layout. */
  columns: string;
  rows: string;
  areas: string;
  /**
   * Content areas in cell order — `blocks[i]` fills `slots[i]`. Positional
   * like promotion-grid's bento slots: switching grids keeps every cell's
   * content, the extra ones simply wait unused.
   */
  slots: string[];
  /** The static category-list area, when the grid carries one. */
  category?: { area: string; side: "left" | "right" };
}

/** Registry order is picker order (mirrors the Figma "Pick a Slider Grid"). */
export const SLIDER_GRIDS: SliderGrid[] = [
  {
    key: "single",
    label: "Single",
    columns: "1fr",
    rows: "1fr",
    areas: '"a"',
    slots: ["a"],
  },
  {
    key: "bento2",
    label: "Bento 2",
    columns: "2fr 1fr",
    rows: "1fr",
    areas: '"a b"',
    slots: ["a", "b"],
  },
  {
    key: "bento3",
    label: "Bento 3",
    columns: "2fr 1fr",
    rows: "1fr 1fr",
    areas: '"a b" "a c"',
    slots: ["a", "b", "c"],
  },
  {
    key: "bento5",
    label: "Bento 5",
    columns: "1fr 1fr 1fr",
    rows: "2fr 1fr",
    areas: '"a a b" "c d e"',
    slots: ["a", "b", "c", "d", "e"],
  },
  {
    key: "masonry",
    label: "Masonry",
    columns: "1fr 1.3fr 1fr",
    rows: "1fr 1fr",
    areas: '"a b c" "a d c"',
    slots: ["a", "b", "c", "d"],
  },
  {
    key: "bento4",
    label: "Bento 4",
    columns: "1fr 2fr 1fr",
    rows: "1fr 1fr",
    areas: '"a b c" "a b d"',
    slots: ["a", "b", "c", "d"],
  },
  {
    key: "leftCategoryBar1",
    label: "Left Category Bar 1",
    columns: "minmax(220px, 1fr) 3.2fr",
    rows: "1fr",
    areas: '"cat a"',
    slots: ["a"],
    category: { area: "cat", side: "left" },
  },
  {
    key: "leftCategoryBar3",
    label: "Left Category Bar 3",
    columns: "minmax(220px, 1fr) 2.2fr 1fr",
    rows: "1fr 1fr",
    areas: '"cat a b" "cat a c"',
    slots: ["a", "b", "c"],
    category: { area: "cat", side: "left" },
  },
  {
    key: "rightCategoryBar1",
    label: "Right Category Bar 1",
    columns: "3.2fr minmax(220px, 1fr)",
    rows: "1fr",
    areas: '"a cat"',
    slots: ["a"],
    category: { area: "cat", side: "right" },
  },
  // Appended for the promotion grid, which wants plainer shapes than a hero.
  // Every grid here is usable by BOTH sections — the only thing that gates a
  // grid to the hero is a `category` area, which reserves a slot the promo
  // grid has nothing to put in.
  {
    key: "duo",
    label: "Two across",
    columns: "1fr 1fr",
    rows: "1fr",
    areas: '"a b"',
    slots: ["a", "b"],
  },
  {
    key: "trio",
    label: "Three across",
    columns: "1fr 1fr 1fr",
    rows: "1fr",
    areas: '"a b c"',
    slots: ["a", "b", "c"],
  },
  {
    key: "quad",
    label: "Four across",
    columns: "1fr 1fr 1fr 1fr",
    rows: "1fr",
    areas: '"a b c d"',
    slots: ["a", "b", "c", "d"],
  },
  {
    key: "stackTop",
    label: "Wide over two",
    columns: "1fr 1fr",
    rows: "1fr 1fr",
    areas: '"a a" "b c"',
    slots: ["a", "b", "c"],
  },
  {
    key: "feature",
    label: "Tall ends",
    columns: "1fr 1fr 1fr 1fr",
    rows: "1fr 1fr",
    areas: '"a b c e" "a d d e"',
    slots: ["a", "b", "c", "d", "e"],
  },
  {
    key: "tallPair",
    label: "Tall pair",
    columns: "1fr 1fr 1fr 1fr",
    rows: "1fr 1fr",
    areas: '"a b c d" "a b e e"',
    slots: ["a", "b", "c", "d", "e"],
  },
];

/**
 * The grids a plain content grid can offer. A `category` grid reserves an
 * area for the store's own category rail, which only the hero fills — so the
 * promotion grid would render a hole where that rail belongs.
 */
export const PROMO_GRIDS: SliderGrid[] = SLIDER_GRIDS.filter(
  (grid) => !grid.category,
);

export const DEFAULT_PROMO_GRID = "feature";

export const DEFAULT_SLIDER_GRID = "single";

export function getSliderGrid(key: unknown): SliderGrid {
  return (
    SLIDER_GRIDS.find((grid) => grid.key === key) ??
    (SLIDER_GRIDS[0] as SliderGrid)
  );
}

/** The most slots any grid exposes — the cell block cap. */
export const MAX_SLIDER_CELLS = SLIDER_GRIDS.reduce(
  (max, grid) => Math.max(max, grid.slots.length),
  0,
);

/** The Figma "Pick a Slider Width Style" options, overriding the global container. */
export const SLIDER_WIDTHS = [
  { key: "fixed", label: "Fixed width" },
  { key: "full", label: "Full width" },
  { key: "fullPadding", label: "Full width with padding" },
  { key: "fullHeight", label: "Full width / full height" },
  { key: "fullHeightPadding", label: "Full width / full height with padding" },
] as const;

export const DEFAULT_SLIDER_WIDTH = "fixed";

/** The Figma "Pick a Slider Height Style" options — viewport-height steps. */
export const SLIDER_HEIGHTS = [
  { key: "full", label: "Full" },
  { key: "fourFifths", label: "4/5" },
  { key: "threeQuarters", label: "3/4" },
  { key: "threeFifths", label: "3/5" },
  { key: "half", label: "1/2" },
  { key: "quarter", label: "1/4" },
] as const;

export const DEFAULT_SLIDER_HEIGHT = "half";

/**
 * Sentinel width/height value meaning "inherit the theme's global slider
 * settings" (Themes → Theme settings). Sections keep their own explicit
 * choices; only instances set to this follow the theme.
 */
export const THEME_SLIDER_INHERIT = "theme";

/**
 * Resolve a section's width/height to concrete style keys: explicit values
 * pass through, "theme" reads the active theme's `sliderWidth`/`sliderHeight`
 * settings (carried on the render context), anything else falls back to the
 * section defaults.
 */
export function resolveSliderLayout(
  settings: Record<string, unknown>,
  themeSettings: Record<string, unknown> | undefined,
): { width: string; height: string } {
  const widthKeys = SLIDER_WIDTHS.map((width) => width.key as string);
  const heightKeys = SLIDER_HEIGHTS.map((height) => height.key as string);

  const pick = (value: unknown, themeValue: unknown, keys: string[], fallback: string) => {
    if (typeof value === "string" && keys.includes(value)) return value;
    if (value === THEME_SLIDER_INHERIT || value === undefined || value === "") {
      if (typeof themeValue === "string" && keys.includes(themeValue)) {
        return themeValue;
      }
    }
    return fallback;
  };

  return {
    width: pick(
      settings.width,
      themeSettings?.sliderWidth,
      widthKeys,
      DEFAULT_SLIDER_WIDTH,
    ),
    height: pick(
      settings.height,
      themeSettings?.sliderHeight,
      heightKeys,
      DEFAULT_SLIDER_HEIGHT,
    ),
  };
}

/** The grid shipped with these; the spacing fields default to them. */
export const SECTION_GRID_SPACING = {
  gap: { default: 14, min: 0, max: 48 },
  sidePadding: { default: 16, min: 0, max: 80 },
  radius: { default: 12, min: 0, max: 48 },
} as const;

/** Corners either set here, or the theme's card radius (Themes → Shapes). */
export const SECTION_GRID_CORNERS = ["custom", "theme"] as const;

/**
 * The spacing fields a grid section carries (the Slider and the Promotion
 * Grid). The defaults ARE the values the grids shipped with — 12px gaps
 * (14px from lg), 16px at the sides of the padded widths, 12px corners in
 * the contained widths — so an untouched section is unchanged.
 */
export const SECTION_GRID_SPACING_FIELDS: Field[] = [
  {
    key: "gap",
    type: "number",
    default: SECTION_GRID_SPACING.gap.default,
    min: SECTION_GRID_SPACING.gap.min,
    max: SECTION_GRID_SPACING.gap.max,
    width: "third",
    hint: "Between the cells, in pixels. Phones use a little less.",
  },
  {
    key: "sidePadding",
    type: "number",
    default: SECTION_GRID_SPACING.sidePadding.default,
    min: SECTION_GRID_SPACING.sidePadding.min,
    max: SECTION_GRID_SPACING.sidePadding.max,
    width: "third",
    hint: "At the sides of the grid, in pixels. The edge-to-edge widths ignore it.",
  },
  {
    key: "corners",
    type: "select",
    options: SECTION_GRID_CORNERS,
    default: "custom",
    width: "third",
    hint: "The edge-to-edge widths stay square.",
  },
  {
    key: "radius",
    type: "number",
    default: SECTION_GRID_SPACING.radius.default,
    min: SECTION_GRID_SPACING.radius.min,
    max: SECTION_GRID_SPACING.radius.max,
    width: "third",
    showWhen: { key: "corners", values: ["custom"] },
  },
];

export interface SectionGridSpacing {
  /** px between cells on desktop; phones take a little less. */
  gap: number;
  /** px at the sides of the grid; the edge-to-edge widths ignore it. */
  sidePadding: number;
  /** A CSS length for the cells' corners. */
  radius: string;
}

/**
 * A grid section's spacing settings, with the shipped values for anything
 * unset — so a promotion grid saved before these existed keeps its 12px
 * corners and 14px gaps.
 */
export function readSectionGridSpacing(
  settings: Record<string, unknown>,
): SectionGridSpacing {
  const num = (value: unknown, spec: { default: number; min: number; max: number }) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(spec.max, Math.max(spec.min, Math.round(value)))
      : spec.default;
  const radius = num(settings.radius, SECTION_GRID_SPACING.radius);
  return {
    gap: num(settings.gap, SECTION_GRID_SPACING.gap),
    sidePadding: num(settings.sidePadding, SECTION_GRID_SPACING.sidePadding),
    radius:
      settings.corners === "theme"
        ? `var(--store-radius-card, ${SECTION_GRID_SPACING.radius.default}px)`
        : `${radius}px`,
  };
}

type SliderCellKind = "slider" | "image";

/** What one grid cell holds, read leniently from a cell block's settings. */
export interface SliderCellContent {
  kind: SliderCellKind;
  slider: string;
  image: string;
  link: string;
  alt: string;
}

export function readSliderCell(
  settings: Record<string, unknown> | undefined,
): SliderCellContent {
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    kind: settings?.kind === "image" ? "image" : "slider",
    slider: str(settings?.slider),
    image: str(settings?.image),
    link: str(settings?.link),
    alt: str(settings?.alt),
  };
}

/** True when the cell actually renders something. */
export function sliderCellIsFilled(cell: SliderCellContent): boolean {
  return cell.kind === "image" ? Boolean(cell.image) : Boolean(cell.slider);
}

const emptyCellSettings = (): Record<string, unknown> => ({
  kind: "slider",
  slider: "",
  image: "",
  link: "",
  alt: "",
});

function cellBlock(
  sectionId: string,
  index: number,
  settings: Record<string, unknown>,
): BlockInstance {
  // Deterministic ids keep the migration idempotent across reads — the same
  // v1 document always yields the same v2 blocks.
  return {
    id: `${sectionId}-cell-${index + 1}`,
    type: "cell",
    visible: true,
    settings,
  };
}

/**
 * v1 → v2: the slideshow's layout moved from `layout` (classic/showcase) +
 * inline slide blocks + saved-slider binding to a grid of cells, each bound
 * to a saved Slider or a static image. Pure and client-safe so the admin
 * studio can derive its view of a not-yet-migrated draft with the exact
 * logic the server applies on read and write.
 *
 * Legacy inline slides carry over as image cells (their carousel behaviour
 * lives on the Sliders page now); a bound saved slider becomes the main
 * cell; the showcase row maps to the Left Category Bar 3 grid with its two
 * promo cards as the stacked side cells.
 */
export function migrateSlideshowV1(instance: SectionInstance): SectionInstance {
  const s = instance.settings ?? {};
  // Already authored in the v2 shape (the editor writes grid before the
  // version bump lands) — just stamp the version.
  if (typeof s.grid === "string" && s.grid) {
    return { ...instance, version: 2 };
  }

  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const showcase = s.layout === "showcase";
  const grid = showcase ? "leftCategoryBar3" : "single";
  const width = s.width === "full" ? "full" : "fixed";
  const height =
    s.height === "full" || s.height === "threeQuarters" || s.height === "half"
      ? (s.height as string)
      : "quarter"; // "banner" and "quarter" were the short frames

  const slides = (instance.blocks ?? []).filter(
    (block) => block.type === "slide" && block.visible,
  );
  const handle = str(s.slider);

  const cells: BlockInstance[] = [];
  const pushImageCell = (image: string, link: string, alt: string) => {
    cells.push(
      cellBlock(instance.id, cells.length, {
        ...emptyCellSettings(),
        kind: "image",
        image,
        link,
        alt,
      }),
    );
  };

  // Main cell: the saved-slider binding wins; otherwise the first slide
  // with artwork carries over as a static image.
  const slideImages = slides
    .map((block) => ({
      image: str(block.settings.image),
      link: str(block.settings.link),
      alt: str(block.settings.alt),
    }))
    .filter((slide) => slide.image);
  if (handle) {
    cells.push(
      cellBlock(instance.id, 0, { ...emptyCellSettings(), slider: handle }),
    );
  } else if (slideImages.length > 0) {
    const [first] = slideImages;
    pushImageCell(first.image, first.link, first.alt);
    slideImages.shift();
  } else if (showcase) {
    // Keep the slot so the showcase's side cards land in positions 2 and 3.
    cells.push(cellBlock(instance.id, 0, emptyCellSettings()));
  }

  if (showcase) {
    for (const slot of ["One", "Two"] as const) {
      const image = str(s[`sideCard${slot}Image`]);
      const link = str(s[`sideCard${slot}Link`]);
      if (image || link) pushImageCell(image, link, "");
      else cells.push(cellBlock(instance.id, cells.length, emptyCellSettings()));
    }
  } else {
    // Remaining slides fill further cells — invisible in the single grid,
    // but there the moment a bento grid is picked.
    for (const slide of slideImages) {
      if (cells.length >= MAX_SLIDER_CELLS) break;
      pushImageCell(slide.image, slide.link, slide.alt);
    }
  }

  return {
    ...instance,
    version: 2,
    settings: { grid, width, height },
    blocks: cells,
  };
}

/**
 * v1 → v2 for the promotion grid: five positional `card` blocks (image, link,
 * caption) become grid cells, and the two hand-built layouts become grid keys.
 * Pure and client-safe, like the slideshow's migration, so the studio derives
 * exactly the shape the server writes.
 *
 * Cards only ever held images, so every cell migrates as an image cell. The
 * caption moves to `alt`: the old `split` design painted it as a scrim label,
 * which the cell model does not have — dropping it entirely would lose the
 * text, so it survives where it still says something about the picture.
 */
export function migratePromotionGridV1(
  instance: SectionInstance,
): SectionInstance {
  const s = instance.settings ?? {};
  if (typeof s.grid === "string" && s.grid) {
    return { ...instance, version: 2 };
  }

  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const cells = (instance.blocks ?? [])
    .filter((block) => block.type === "card" && block.visible)
    .slice(0, MAX_SLIDER_CELLS)
    .map((block, index) =>
      cellBlock(instance.id, index, {
        ...emptyCellSettings(),
        kind: "image",
        image: str(block.settings.image),
        link: str(block.settings.link),
        alt: str(block.settings.label),
      }),
    );

  return {
    ...instance,
    version: 2,
    // "split" was the tall-ends layout; the plain bento maps to the five-slot
    // grid it was drawn as.
    settings: {
      grid: s.variant === "split" ? "feature" : "bento5",
      width: "fixed",
      height: "quarter",
    },
    blocks: cells,
  };
}
