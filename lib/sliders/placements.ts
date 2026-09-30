import { connectDB } from "@/lib/db";
import { StorePage } from "@/models";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import {
  migratePromotionGridV1,
  migrateSlideshowV1,
  readSectionGridSpacing,
  readSliderCell,
  resolveSliderLayout,
  SLIDER_GRIDS,
} from "@/lib/storefront/sections/slider-grids";
import { readProductsListingLayout } from "@/lib/storefront/sections/products-listing-layout";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import {
  cellFrame,
  gridBoxWidth,
  PLACEMENT_VIEWPORTS,
  type PlacementViewportKey,
} from "@/lib/sliders/placement-geometry";
import { shapeForFrame, SLIDE_FRAMES, type SlideShape } from "@/lib/sliders/types";
import type { BlockInstance, SectionInstance } from "@/lib/storefront/sections/types";

/**
 * Where a saved slider actually appears on the shop.
 *
 * Nothing asked this before. Sections reference a slider one way — they
 * store its handle — so the editor had no idea which frames a slide would
 * land in and offered three fixed artboards instead, of which the one it
 * opened on was usually not the one the shop would use. Deleting a slider
 * four pages depended on was unguarded for the same reason.
 *
 * The scan reads every store page's section tree and matches the four ways
 * a handle can be bound, then measures each placement's frame with
 * `placement-geometry`. A frame that cannot be known exactly says so.
 */

export interface PlacementFrame {
  viewport: PlacementViewportKey;
  label: string;
  width: number;
  height: number;
  band: SlideShape;
  exact: boolean;
  assumption?: string;
}

export interface SliderPlacement {
  /** The store page this sits on — the canonical key, e.g. `template:home:default`. */
  pageKey: string;
  pageKind: string;
  pageTitle: string;
  /** Whether it was found in the published tree, the draft, or both. */
  state: "published" | "draft" | "both";
  sectionId: string;
  sectionType: string;
  /** Which cell of the grid, when the placement is a grid cell. */
  slotIndex?: number;
  slotArea?: string;
  gridKey?: string;
  /** What to call it in the editor's artboard picker. */
  label: string;
  frames: PlacementFrame[];
}

type Settings = Record<string, unknown>;

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** The blocks of a section, normalised to an array. */
function blocksOf(section: SectionInstance): BlockInstance[] {
  return Array.isArray(section.blocks) ? section.blocks : [];
}

/**
 * A v1 slideshow stored its handle at `settings.slider` with no cell
 * blocks, so a scanner that only looked at blocks would miss every page
 * that has not been touched since. Both grid sections are migrated first,
 * exactly as the renderer does.
 */
function migrated(section: SectionInstance): SectionInstance {
  if (section.type === "slideshow") return migrateSlideshowV1(section);
  if (section.type === "promotion-grid") return migratePromotionGridV1(section);
  return section;
}

function gridFrames(options: {
  section: SectionInstance;
  slotIndex: number;
  kind: "hero" | "promo";
  themeLayout: Settings;
  pageWidth: string;
}): PlacementFrame[] {
  const settings = (options.section.settings ?? {}) as Settings;
  const layout = resolveSliderLayout(settings, options.themeLayout);
  const spacing = readSectionGridSpacing(settings);
  const gridKey = str(settings.grid) || (options.kind === "promo" ? "feature" : "single");
  return PLACEMENT_VIEWPORTS.flatMap((viewport) => {
    const frame = cellFrame({
      gridKey,
      slotIndex: options.slotIndex,
      section: options.kind,
      sliderWidth: layout.width,
      sliderHeight: layout.height,
      sidePadding: spacing.sidePadding,
      gap: spacing.gap,
      pageWidth: options.pageWidth,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    });
    if (!frame) return [];
    return [
      {
        viewport: viewport.key,
        label: viewport.label,
        width: frame.width,
        height: frame.height,
        band: shapeForFrame(frame.width, frame.height),
        exact: frame.exact,
        assumption: frame.assumption,
      },
    ];
  });
}

/**
 * The listing's cover banner: the one placement with no grid. Its width is
 * the page (or the viewport, edge to edge) and its height is either the
 * merchant's number or the hero frame's own ratio.
 */
function coverFrames(section: SectionInstance, pageWidth: string): PlacementFrame[] {
  const layout = readProductsListingLayout((section.settings ?? {}) as Settings);
  const contained = layout.coverWidth !== "full";
  return PLACEMENT_VIEWPORTS.map((viewport) => {
    const width = contained
      ? gridBoxWidth({
          viewportWidth: viewport.width,
          pageWidth,
          sliderWidth: "fixed",
          sidePadding: 16,
        })
      : viewport.width;
    const height =
      layout.coverHeight > 0
        ? layout.coverHeight
        : Math.round((width * SLIDE_FRAMES.landscape.height) / SLIDE_FRAMES.landscape.width);
    return {
      viewport: viewport.key,
      label: viewport.label,
      width,
      height,
      band: shapeForFrame(width, height),
      exact: true,
    };
  });
}

/**
 * The featured collection's feature panel.
 *
 * Below `lg` this is exact: one column, and a fixed 288px floor. From `lg`
 * the panel is `h-full` in a row whose height the product cards set — which
 * depends on how many lines the translated titles wrap to — so unless the
 * merchant fixed a panel height, there is no honest number and the frame is
 * reported as inexact.
 */
function panelFrames(section: SectionInstance, pageWidth: string): PlacementFrame[] {
  const settings = (section.settings ?? {}) as Settings;
  const panelHeight =
    typeof settings.panelHeight === "number" && settings.panelHeight > 0
      ? settings.panelHeight
      : 0;
  const panelWidth =
    typeof settings.panelWidth === "number" && settings.panelWidth > 0
      ? settings.panelWidth
      : 0;
  return PLACEMENT_VIEWPORTS.map((viewport) => {
    const row = gridBoxWidth({
      viewportWidth: viewport.width,
      pageWidth,
      sliderWidth: "fixed",
      sidePadding: 16,
    });
    if (viewport.width < 1024) {
      // One column, and the panel's own min-height floor.
      return {
        viewport: viewport.key,
        label: viewport.label,
        width: row,
        height: 288,
        band: shapeForFrame(row, 288),
        exact: true,
      };
    }
    // Three parts panel to two parts per card, unless a width was set.
    const width = panelWidth > 0 ? Math.round((row * panelWidth) / 100) : Math.round((row * 3) / 11);
    const height = panelHeight > 0 ? panelHeight : Math.round(width * 1.4);
    return {
      viewport: viewport.key,
      label: viewport.label,
      width,
      height,
      band: shapeForFrame(width, height),
      exact: panelHeight > 0,
      assumption:
        panelHeight > 0 ? undefined : "height follows the product cards beside it",
    };
  });
}

function gridLabel(gridKey: string, slotIndex: number): string {
  const grid = SLIDER_GRIDS.find((entry) => entry.key === gridKey);
  const area = grid?.slots[slotIndex];
  const cell = area ? area.toUpperCase() : String(slotIndex + 1);
  return grid ? `${grid.label} · cell ${cell}` : `cell ${cell}`;
}

/** Every binding of one handle inside one section. */
function placementsInSection(
  section: SectionInstance,
  handle: string,
  context: { themeLayout: Settings; pageWidth: string },
): Omit<SliderPlacement, "pageKey" | "pageKind" | "pageTitle" | "state">[] {
  const found: Omit<SliderPlacement, "pageKey" | "pageKind" | "pageTitle" | "state">[] = [];
  const settings = (section.settings ?? {}) as Settings;

  if (section.type === "slideshow" || section.type === "promotion-grid") {
    const kind = section.type === "promotion-grid" ? "promo" : "hero";
    const gridKey =
      str(settings.grid) || (kind === "promo" ? "feature" : "single");
    blocksOf(section).forEach((block, slotIndex) => {
      if (block.type !== "cell") return;
      const cell = readSliderCell(block.settings as Settings);
      if (cell.kind !== "slider" || cell.slider !== handle) return;
      found.push({
        sectionId: section.id,
        sectionType: section.type,
        slotIndex,
        slotArea: SLIDER_GRIDS.find((g) => g.key === gridKey)?.slots[slotIndex],
        gridKey,
        label: gridLabel(gridKey, slotIndex),
        frames: gridFrames({ section, slotIndex, kind, ...context }),
      });
    });
    return found;
  }

  if (section.type === "featured-collection") {
    blocksOf(section).forEach((block, index) => {
      const blockSettings = (block.settings ?? {}) as Settings;
      if (blockSettings.kind !== "slider" || str(blockSettings.slider) !== handle) return;
      found.push({
        sectionId: section.id,
        sectionType: section.type,
        slotIndex: index,
        label: `Collection row ${index + 1} · feature panel`,
        frames: panelFrames(section, context.pageWidth),
      });
    });
    return found;
  }

  if (section.type === "products-main" && str(settings.coverSlider) === handle) {
    found.push({
      sectionId: section.id,
      sectionType: section.type,
      label: "Listing cover",
      frames: coverFrames(section, context.pageWidth),
    });
  }
  return found;
}

/** One store page, as much of it as the scan reads. */
export interface ScannablePage {
  key: unknown;
  kind?: unknown;
  title?: unknown;
  draft?: { sections?: unknown } | null;
  published?: { sections?: unknown } | null;
}

/**
 * Every place a handle is bound across a set of pages — the whole of the
 * matching, with no database and no request context, so a test can drive it
 * with real page trees.
 */
export function placementsForPages(
  pages: ScannablePage[],
  handle: string,
  context: { themeLayout: Settings; pageWidth: string },
): SliderPlacement[] {
  if (!handle) return [];
  const byKey = new Map<string, SliderPlacement>();
  for (const page of pages) {
    const trees: [("published" | "draft"), unknown][] = [
      ["published", page.published?.sections],
      ["draft", page.draft?.sections],
    ];
    for (const [state, raw] of trees) {
      for (const section of sanitizeSectionInstances(raw).map(migrated)) {
        for (const found of placementsInSection(section, handle, context)) {
          const id = `${page.key}:${found.sectionId}:${found.slotIndex ?? "x"}`;
          const existing = byKey.get(id);
          if (existing) {
            // Present in both trees: say so rather than listing it twice.
            if (existing.state !== state) existing.state = "both";
            continue;
          }
          byKey.set(id, {
            pageKey: String(page.key),
            pageKind: String(page.kind ?? ""),
            pageTitle: typeof page.title === "string" ? page.title : String(page.key),
            state,
            ...found,
          });
        }
      }
    }
  }
  return [...byKey.values()];
}

/**
 * Every place a slider handle is bound, across every store page, with the
 * frames each one renders at.
 *
 * Reads both the published and the draft tree: a merchant editing a slide
 * cares about the placement they are about to publish as much as the one
 * already live.
 */
export async function findSliderPlacements(handle: string): Promise<SliderPlacement[]> {
  if (!handle) return [];
  await connectDB();
  const [pages, storefront] = await Promise.all([
    StorePage.find({})
      .select("key kind templateType handle title draft.sections published.sections")
      .lean(),
    getStorefrontSettings(),
  ]);
  const themeLayout = (storefront.theme?.settings?.layout ?? {}) as Settings;
  return placementsForPages(pages as unknown as ScannablePage[], handle, {
    themeLayout,
    pageWidth: str(themeLayout.pageWidth) || "1280",
  });
}
