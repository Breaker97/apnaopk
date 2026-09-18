import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import {
  SectionGrid,
  SectionGridSkeleton,
} from "../section-grid";
import {
  DEFAULT_PROMO_GRID,
  MAX_SLIDER_CELLS,
  PROMO_GRIDS,
  SECTION_GRID_SPACING_FIELDS,
  SLIDER_HEIGHTS,
  SLIDER_WIDTHS,
  THEME_SLIDER_INHERIT,
  getSliderGrid,
  migratePromotionGridV1,
  readSectionGridSpacing,
  readSliderCell,
  resolveSliderLayout,
  sliderCellIsFilled,
} from "../slider-grids";
import type { SectionDefinition } from "../types";

/**
 * How tall the promo grid runs, keyed by the shared Height Style vocabulary
 * (the studio's panels write these keys for the hero and the promo grid
 * alike). Shorter steps than the hero's: a promo strip sits between other
 * sections rather than filling the first viewport, so even "full" stays a
 * band short of the whole screen.
 */
const HEIGHT_CLASSES: Record<string, string> = {
  quarter: "lg:h-[26svh]",
  half: "lg:h-[38svh]",
  threeFifths: "lg:h-[45svh]",
  threeQuarters: "lg:h-[52svh]",
  fourFifths: "lg:h-[60svh]",
  full: "lg:h-[70svh]",
};
const DEFAULT_HEIGHT = "half";

/** The "full height" width styles fill the viewport under the header. */
const FULL_HEIGHT_CLASS =
  "lg:h-[calc(100svh-var(--store-chrome-h,5rem))]"; // see slideshow.tsx

/**
 * The Promotion Grid: a GRID of cells, each holding either a saved Slider
 * (Online Store → Sliders) or a static linked image — the same model as the
 * Hero Slider, and the same renderer (`section-grid.tsx`).
 *
 * It used to be two hand-wired layouts with five image-only slots. Cells make
 * the layouts data instead of code, and let a promo tile carry a rotating
 * slider rather than one flat picture.
 */
export const promotionGrid: SectionDefinition = {
  type: "promotion-grid",
  version: 2,
  category: "promotions",
  suggested: true,
  fields: [
    {
      key: "grid",
      type: "select",
      options: PROMO_GRIDS.map((grid) => grid.key),
      default: DEFAULT_PROMO_GRID,
    },
    // Width and height share the hero's Style vocabulary — the studio's
    // setup panels write the same keys for both sections. "theme" inherits
    // the global values from Themes → Theme settings; the defaults stay
    // explicit here because a promo band mid-page shouldn't balloon when a
    // theme ships a full-viewport hero.
    {
      key: "width",
      type: "select",
      options: [
        THEME_SLIDER_INHERIT,
        ...SLIDER_WIDTHS.map((width) => width.key),
      ],
      default: "fixed",
    },
    {
      key: "height",
      type: "select",
      options: [
        THEME_SLIDER_INHERIT,
        ...SLIDER_HEIGHTS.map((height) => height.key),
      ],
      default: DEFAULT_HEIGHT,
    },
    // Spacing and corners, shared with the Slider.
    ...SECTION_GRID_SPACING_FIELDS,
  ],
  blocks: [
    {
      // Positional slots: blocks[i] fills the grid's slots[i]. Cells beyond
      // the active grid's slot count keep their content and wait for a
      // bigger grid — switching grids never destroys anything.
      type: "cell",
      max: MAX_SLIDER_CELLS,
      fields: [
        {
          key: "kind",
          type: "select",
          options: ["slider", "image"],
          default: "image",
        },
        { key: "slider", type: "slider", default: "" },
        { key: "image", type: "image" },
        { key: "link", type: "url", default: "" },
        { key: "alt", type: "text", default: "" },
      ],
    },
  ],
  starter: { blocks: [] },
  migrate: migratePromotionGridV1,
  async Render({ settings, blocks, ctx }) {
    const grid = getSliderGrid(settings.grid);
    const cells = grid.slots.map((_, index) => {
      const block = blocks[index];
      return block && block.visible ? readSliderCell(block.settings) : null;
    });

    if (!cells.some((cell) => cell && sliderCellIsFilled(cell))) {
      return sectionEmptyState(ctx, {
        title: "Promotion Grid",
        hint: "Pick a saved slider or an image for each grid cell in the builder.",
      });
    }

    const { width, height } = resolveSliderLayout(settings, ctx.themeSettings);
    const fullHeight = width === "fullHeight" || width === "fullHeightPadding";
    const heightClass = fullHeight
      ? FULL_HEIGHT_CLASS
      : (HEIGHT_CLASSES[height] ?? HEIGHT_CLASSES[DEFAULT_HEIGHT]);
    const spacing = readSectionGridSpacing(settings);
    // Edge to edge means square: a rounded corner against the screen's own
    // edge shows the page through the gap.
    const edgeToEdge = width === "full" || width === "fullHeight";
    const gridNode = (
      <SectionGrid
        grid={grid}
        cells={cells}
        locale={ctx.locale}
        heightClass={heightClass}
        gap={spacing.gap}
        radius={edgeToEdge ? "0px" : spacing.radius}
      />
    );

    if (edgeToEdge) {
      return <section>{gridNode}</section>;
    }
    if (width === "fullPadding" || width === "fullHeightPadding") {
      return (
        <section className="py-4">
          <div style={{ paddingInline: spacing.sidePadding }}>{gridNode}</div>
        </section>
      );
    }
    return (
      <section className="py-4 lg:py-6">
        <div className="container mx-auto" style={{ paddingInline: spacing.sidePadding }}>
          {gridNode}
        </div>
      </section>
    );
  },
  Skeleton: ({ settings, ctx }) => {
    const grid = getSliderGrid(settings.grid);
    const { width, height } = resolveSliderLayout(settings, ctx?.themeSettings);
    const fullHeight = width === "fullHeight" || width === "fullHeightPadding";
    const spacing = readSectionGridSpacing(settings);
    const edgeToEdge = width === "full" || width === "fullHeight";
    const frame = (
      <SectionGridSkeleton
        grid={grid}
        heightClass={
          fullHeight
            ? FULL_HEIGHT_CLASS
            : (HEIGHT_CLASSES[height] ?? HEIGHT_CLASSES[DEFAULT_HEIGHT])
        }
        gap={spacing.gap}
        radius={edgeToEdge ? "0px" : spacing.radius}
      />
    );
    if (edgeToEdge) {
      return <section aria-hidden>{frame}</section>;
    }
    if (width === "fullPadding" || width === "fullHeightPadding") {
      return (
        <section className="py-4" aria-hidden>
          <div style={{ paddingInline: spacing.sidePadding }}>{frame}</div>
        </section>
      );
    }
    return (
      <section className="py-4 lg:py-6" aria-hidden>
        <div className="container mx-auto" style={{ paddingInline: spacing.sidePadding }}>
          {frame}
        </div>
      </section>
    );
  },
};
