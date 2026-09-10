import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import { SectionGrid, SectionGridSkeleton } from "../section-grid";
import {
  DEFAULT_SLIDER_GRID,
  DEFAULT_SLIDER_HEIGHT,
  MAX_SLIDER_CELLS,
  SLIDER_GRIDS,
  SLIDER_HEIGHTS,
  SLIDER_WIDTHS,
  THEME_SLIDER_INHERIT,
  getSliderGrid,
  migrateSlideshowV1,
  readSliderCell,
  resolveSliderLayout,
  sliderCellIsFilled,
} from "../slider-grids";
import type { SectionDefinition } from "../types";

/**
 * Viewport-height steps for the Figma "Slider Height Style" panel. They bind
 * from lg up — below that the grid stacks and each cell keeps its own
 * aspect, so a viewport height would crush a five-cell bento into slivers.
 */
const HEIGHT_CLASSES: Record<string, string> = {
  quarter: "lg:h-[30svh]",
  half: "lg:h-[50svh]",
  threeFifths: "lg:h-[60svh]",
  threeQuarters: "lg:h-[70svh]",
  fourFifths: "lg:h-[78svh]",
  full: "lg:h-[85svh]",
};

/**
 * The "full height" width styles override the height panel: they exist to
 * fill the first viewport under the header, whatever height was picked.
 * `--store-chrome-h` is the header chrome's measured height (announcement
 * bar + whatever the Header Studio built), published by the storefront
 * layout's StoreChromeHeight; 5rem only until it has measured.
 */
const FULL_HEIGHT_CLASS =
  "lg:h-[calc(100svh-var(--store-chrome-h,5rem))]";

/**
 * The Hero Slider. The section is a GRID of cells (`slider-grids.ts` is the
 * layout vocabulary): each cell binds a saved Slider (Online Store →
 * Sliders) by handle or holds a static linked image, and the category-bar
 * grids reserve one area for the store's root-category rail. Slides
 * themselves — and the money invariant behind their Price element — are
 * authored on the Sliders page; this section only arranges where sliders
 * appear.
 */
export const slideshow: SectionDefinition = {
  type: "slideshow",
  version: 2,
  category: "promotions",
  suggested: true,
  fields: [
    {
      key: "grid",
      type: "select",
      options: SLIDER_GRIDS.map((grid) => grid.key),
      default: DEFAULT_SLIDER_GRID,
    },
    // Width and height per the Figma "Slider Width/Height Style" panels.
    // "theme" (the default for new heroes) inherits the global values from
    // Themes → Theme settings; an explicit pick overrides them for this
    // section only.
    {
      key: "width",
      type: "select",
      options: [
        THEME_SLIDER_INHERIT,
        ...SLIDER_WIDTHS.map((width) => width.key),
      ],
      default: THEME_SLIDER_INHERIT,
    },
    {
      key: "height",
      type: "select",
      options: [
        THEME_SLIDER_INHERIT,
        ...SLIDER_HEIGHTS.map((height) => height.key),
      ],
      default: THEME_SLIDER_INHERIT,
    },
  ],
  blocks: [
    {
      // Positional slots like promotion-grid's bento: blocks[i] fills the
      // grid's slots[i]. Cells beyond the active grid's slot count keep
      // their content and wait for a bigger grid.
      type: "cell",
      max: MAX_SLIDER_CELLS,
      fields: [
        {
          key: "kind",
          type: "select",
          options: ["slider", "image"],
          default: "slider",
        },
        { key: "slider", type: "slider", default: "" },
        { key: "image", type: "image" },
        { key: "link", type: "url", default: "" },
        { key: "alt", type: "text", default: "" },
      ],
    },
  ],
  starter: { blocks: [] },
  migrate: migrateSlideshowV1,
  async Render({ settings, blocks, ctx }) {
    const grid = getSliderGrid(settings.grid);
    const cells = grid.slots.map((_, index) => {
      const block = blocks[index];
      return block && block.visible ? readSliderCell(block.settings) : null;
    });

    // A grid with no assigned cell (and no category rail to carry it) has
    // nothing to show: null on the live storefront, a labelled outline in
    // the draft preview.
    if (
      !grid.category &&
      !cells.some((cell) => cell && sliderCellIsFilled(cell))
    ) {
      return sectionEmptyState(ctx, {
        title: "Hero Slider",
        hint: "Pick a saved slider or an image for each grid cell in the builder.",
      });
    }

    const { width, height } = resolveSliderLayout(settings, ctx.themeSettings);
    const fullBleed = width !== "fixed";
    const fullHeight = width === "fullHeight" || width === "fullHeightPadding";
    const heightClass = fullHeight
      ? FULL_HEIGHT_CLASS
      : (HEIGHT_CLASSES[height] ?? HEIGHT_CLASSES[DEFAULT_SLIDER_HEIGHT]);
    const roundedClass =
      width === "full" || width === "fullHeight" ? "rounded-none" : "rounded-xl";

    const gridNode = (
      <SectionGrid
        grid={grid}
        cells={cells}
        locale={ctx.locale}
        heightClass={heightClass}
        roundedClass={roundedClass}
      />
    );

    if (!fullBleed) {
      return (
        <section className="py-4 lg:py-6">
          <div className="container mx-auto px-4">{gridNode}</div>
        </section>
      );
    }
    if (width === "fullPadding" || width === "fullHeightPadding") {
      return (
        <section className="py-4">
          <div className="px-4">{gridNode}</div>
        </section>
      );
    }
    // "full" and "fullHeight" bleed edge to edge: no container, no rounding.
    return <section>{gridNode}</section>;
  },
  Skeleton: ({ settings, ctx }) => {
    const grid = getSliderGrid(settings.grid);
    const { width, height } = resolveSliderLayout(settings, ctx?.themeSettings);
    const fullHeight = width === "fullHeight" || width === "fullHeightPadding";
    const heightClass = fullHeight
      ? FULL_HEIGHT_CLASS
      : (HEIGHT_CLASSES[height] ?? HEIGHT_CLASSES[DEFAULT_SLIDER_HEIGHT]);
    const roundedClass =
      width === "full" || width === "fullHeight" ? "rounded-none" : "rounded-xl";
    const frame = (
      <SectionGridSkeleton
        grid={grid}
        heightClass={heightClass}
        roundedClass={roundedClass}
      />
    );
    if (width === "fixed" || !width) {
      return (
        <section className="py-4 lg:py-6" aria-hidden>
          <div className="container mx-auto px-4">{frame}</div>
        </section>
      );
    }
    if (width === "fullPadding" || width === "fullHeightPadding") {
      return (
        <section className="py-4" aria-hidden>
          <div className="px-4">{frame}</div>
        </section>
      );
    }
    return <section aria-hidden>{frame}</section>;
  },
};
