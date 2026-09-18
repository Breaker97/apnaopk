"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  GalleryHorizontalEnd,
  Image as ImageIcon,
  ImagePlus,
  Package,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { NativeSelect } from "@/components/ui/native-select";
import { SliderRow } from "@/components/admin/store-pages/product-main-editor";
import {
  SECTION_GRID_CORNERS,
  SECTION_GRID_SPACING,
  readSectionGridSpacing,
} from "@/lib/storefront/sections/slider-grids";
import { SliderPreview } from "@/components/admin/sliders/slider-card";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { normalizeSliderDocument, type SliderDocument } from "@/lib/sliders/types";
import {
  SLIDER_GRIDS,
  getSliderGrid,
  migrateSlideshowV1,
  readSliderCell,
  type SliderGrid,
} from "@/lib/storefront/sections/slider-grids";
import {
  RAIL_CATEGORY_LIMIT,
  RAIL_ICON_CLASS,
  RAIL_LINK_CLASS,
  RAIL_LIST_CLASS,
  RAIL_PANEL_CLASS,
  RAIL_ROW_CLASS,
} from "@/lib/storefront/sections/category-rail";
import type {
  BlockInstance,
  SectionInstance,
} from "@/lib/storefront/sections/types";
import { SectionImageField } from "./section-image-field";
import {
  SliderSetupDialog,
  type SliderSetupKind,
} from "./slider-setup-panels";

interface CategoryOption {
  _id: string;
  name: string;
  icon?: string;
  image?: string;
  parentId?: string | null;
}

const emptyCellSettings = (): Record<string, unknown> => ({
  kind: "slider",
  slider: "",
  image: "",
  link: "",
  alt: "",
});

/**
 * The Hero Slider inspector: Grid / Width / Height buttons reopen the same
 * setup panels the add-section wizard showed (preselecting the stored
 * choice), and the canvas below mirrors the chosen grid — every content
 * cell is an "Add Slider" card that binds a saved Slider or a static
 * image, while the category-bar grids show their fixed category list.
 * Slides themselves are authored on the Sliders page.
 */
export function HeroSliderStudio({
  sectionId,
  settings,
  blocks,
  onSettingChange,
  onBlocksChange,
  locale,
  sectionType = "slideshow",
  grids = SLIDER_GRIDS,
  migrate = migrateSlideshowV1,
}: {
  sectionId: string;
  settings: Record<string, unknown>;
  blocks: BlockInstance[];
  onSettingChange: (key: string, value: unknown) => void;
  onBlocksChange: (
    updater: (blocks: BlockInstance[]) => BlockInstance[],
  ) => void;
  locale: string;
  /**
   * Which section this studio is driving. The grid-of-cells model is shared
   * by the Hero Slider and the Promotion Grid, so the studio is too — only
   * the migration, the grid list and the AI image context differ.
   */
  sectionType?: string;
  grids?: SliderGrid[];
  migrate?: (instance: SectionInstance) => SectionInstance;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);

  // A draft may still carry the v1 shape (the server sanitizes but does not
  // migrate what it hands the editor) — derive the view through the same
  // migration the server runs on read/write, and materialize it into the
  // draft on the first real edit, never on merely expanding the row.
  const isLegacy = !(typeof settings.grid === "string" && settings.grid);
  const effective = useMemo(() => {
    if (!isLegacy) return { settings, blocks };
    const migrated = migrate({
      id: sectionId,
      type: sectionType,
      version: 1,
      visible: true,
      settings,
      blocks,
    } satisfies SectionInstance);
    return { settings: migrated.settings, blocks: migrated.blocks ?? [] };
  }, [isLegacy, sectionId, settings, blocks, migrate, sectionType]);

  const gridKey = effective.settings.grid as string;
  const widthKey = effective.settings.width as string;
  const heightKey = effective.settings.height as string;
  const grid = getSliderGrid(gridKey);

  const materializeSettings = (overrides: Record<string, unknown>) => {
    const base = isLegacy
      ? { grid: gridKey, width: widthKey, height: heightKey }
      : {};
    for (const [key, value] of Object.entries({ ...base, ...overrides })) {
      onSettingChange(key, value);
    }
  };

  const commitSetting = (key: string, value: unknown) => {
    materializeSettings({ [key]: value });
    if (isLegacy) onBlocksChange(() => effective.blocks);
  };

  const commitCells = (
    updater: (cells: BlockInstance[]) => BlockInstance[],
  ) => {
    if (isLegacy) {
      materializeSettings({});
      onBlocksChange(() => updater(effective.blocks));
    } else {
      onBlocksChange(updater);
    }
  };

  const setCell = (index: number, patch: Record<string, unknown>) => {
    commitCells((cells) => {
      const next = [...cells];
      while (next.length <= index) {
        next.push({
          id: crypto.randomUUID(),
          type: "cell",
          visible: true,
          settings: emptyCellSettings(),
        });
      }
      const target = next[index];
      next[index] = {
        ...target,
        settings: { ...emptyCellSettings(), ...target.settings, ...patch },
      };
      return next;
    });
  };

  // ---- saved sliders & categories (for previews) --------------------------
  const [sliders, setSliders] = useState<SliderDocument[] | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [setupDialog, setSetupDialog] = useState<SliderSetupKind | null>(null);
  const [spacingOpen, setSpacingOpen] = useState(false);
  const [cellDialog, setCellDialog] = useState<{
    index: number;
    mode: "choose" | "sliders" | "image";
  } | null>(null);

  const loadSliders = () => {
    apiClient
      .get<SliderDocument[]>("/api/admin/sliders")
      .then((list) => {
        if (!Array.isArray(list)) return setSliders([]);
        // Read through the one normalizer: the PUBLISHED content, a
        // pre-version-2 document migrated on the way.
        setSliders(list.map(normalizeSliderDocument));
      })
      .catch(() => setSliders((current) => current ?? []));
  };

  useEffect(loadSliders, []);
  // The Sliders page opens from here in another tab — refresh the list every
  // time the pick dialog comes up so a just-created slider is offered.
  useEffect(() => {
    if (cellDialog?.mode === "sliders") loadSliders();
  }, [cellDialog?.mode]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/categories?flat=true")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const list: CategoryOption[] = Array.isArray(data?.data)
          ? data.data
          : [];
        const roots = list.filter((entry) => !entry.parentId);
        setCategories(
          (roots.length > 0 ? roots : list).slice(0, RAIL_CATEGORY_LIMIT),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const sliderByHandle = useMemo(
    () => new Map((sliders ?? []).map((entry) => [entry.handle, entry])),
    [sliders],
  );

  const slidersHref = `/${locale}/admin/online-store/sliders`;
  const manageLabel = tSafe(
    "admin.storeBuilder.sliderBlock.createEdit",
    "Create / Edit Sliders",
  );

  // ---- render -------------------------------------------------------------
  const settingButtons: { kind: SliderSetupKind; label: string }[] = [
    {
      kind: "grid",
      label: tSafe("admin.storeBuilder.sliderBlock.grid", "Grid"),
    },
    {
      kind: "width",
      label: tSafe("admin.storeBuilder.sliderBlock.width", "Width"),
    },
    {
      kind: "height",
      label: tSafe("admin.storeBuilder.sliderBlock.height", "Height"),
    },
  ];
  const settingValue = (kind: SliderSetupKind) =>
    kind === "grid" ? gridKey : kind === "width" ? widthKey : heightKey;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {settingButtons.map(({ kind, label }) => (
          <Button
            key={kind}
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-lg font-medium"
            onClick={() => setSetupDialog(kind)}
          >
            {label}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        ))}
        {/* Spacing: gaps, side padding and corners. */}
        {sectionType === "promotion-grid" || sectionType === "slideshow" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-lg font-medium"
            onClick={() => setSpacingOpen(true)}
          >
            {tSafe("admin.storeBuilder.sliderBlock.spacing", "Spacing")}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        ) : null}
        <Button asChild type="button" size="sm" className="ms-auto rounded-lg">
          <Link href={slidersHref} target="_blank">
            {manageLabel}
          </Link>
        </Button>
      </div>

      <StudioCanvas
        grid={grid}
        sectionType={sectionType}
        widthKey={widthKey}
        heightKey={heightKey}
        blocks={effective.blocks}
        categories={categories}
        sliderByHandle={sliderByHandle}
        tSafe={tSafe}
        onOpenCell={(index) => setCellDialog({ index, mode: "choose" })}
        onClearCell={(index) => setCell(index, emptyCellSettings())}
      />

      {spacingOpen ? (
        <GridSpacingDialog
          settings={effective.settings}
          onChange={commitSetting}
          onOpenChange={setSpacingOpen}
          tSafe={tSafe}
        />
      ) : null}

      {setupDialog ? (
        <SliderSetupDialog
          kind={setupDialog}
          open
          onOpenChange={(open) => {
            if (!open) setSetupDialog(null);
          }}
          value={settingValue(setupDialog)}
          onSelect={(key) => commitSetting(setupDialog, key)}
          tSafe={tSafe}
          grids={grids}
        />
      ) : null}

      {cellDialog ? (
        <CellContentDialog
          state={cellDialog}
          onStateChange={setCellDialog}
          sectionId={sectionId}
          sectionType={sectionType}
          locale={locale}
          blocks={effective.blocks}
          sliders={sliders}
          slidersHref={slidersHref}
          manageLabel={manageLabel}
          onAssignSlider={(index, handle) => {
            setCell(index, { kind: "slider", slider: handle });
            setCellDialog(null);
          }}
          onPatchCell={setCell}
          tSafe={tSafe}
        />
      ) : null}
    </div>
  );
}

// ---- spacing ---------------------------------------------------------------

/**
 * The promotion grid's spacing controls in a dialog, like the studio's other
 * setup panels: gap between cells, padding at the sides, and corners — set
 * here, or the theme's card radius.
 */
function GridSpacingDialog({
  settings,
  onChange,
  onOpenChange,
  tSafe,
}: {
  settings: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onOpenChange: (open: boolean) => void;
  tSafe: ReturnType<typeof createTSafe>;
}) {
  const spacing = readSectionGridSpacing(settings);
  const corners = settings.corners === "theme" ? "theme" : "custom";
  const radius =
    typeof settings.radius === "number"
      ? settings.radius
      : SECTION_GRID_SPACING.radius.default;
  const label = (key: string, fallback: string) =>
    tSafe(`admin.storeBuilder.fields.${key}`, fallback);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {tSafe("admin.storeBuilder.sliderBlock.spacingTitle", "Spacing and corners")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <SliderRow
            label={label("gap", "Gap between cells")}
            value={spacing.gap}
            max={SECTION_GRID_SPACING.gap.max}
            onChange={(gap) => onChange("gap", gap)}
          />
          <SliderRow
            label={label("sidePadding", "Side padding")}
            value={spacing.sidePadding}
            max={SECTION_GRID_SPACING.sidePadding.max}
            onChange={(sidePadding) => onChange("sidePadding", sidePadding)}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-foreground">
              {label("corners", "Corners")}
            </span>
            <NativeSelect
              value={corners}
              aria-label={label("corners", "Corners")}
              onChange={(event) => onChange("corners", event.target.value)}
              className="h-9 w-44 shrink-0"
            >
              {SECTION_GRID_CORNERS.map((option) => (
                <option key={option} value={option}>
                  {tSafe(`admin.storeBuilder.options.${option}`, option)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {corners === "custom" ? (
            <SliderRow
              label={label("radius", "Corner radius")}
              value={radius}
              max={SECTION_GRID_SPACING.radius.max}
              onChange={(next) => onChange("radius", next)}
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            {tSafe(
              "admin.storeBuilder.sliderBlock.spacingHint",
              "The edge-to-edge widths stay square and ignore the side padding.",
            )}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- canvas ---------------------------------------------------------------

/**
 * The canvas takes the PROPORTIONS the live frame gets from the section's
 * Width/Height settings, measured at a nominal 1440×900 desktop. The live
 * grid is an svh-height box, so a slider bg image is object-cover cropped
 * to whatever shape those settings produce — a canvas with a shape of its
 * own would preview a different crop than the one that ships.
 */
const PREVIEW_VIEWPORT = { width: 1440, height: 900, container: 1328 };
/**
 * Mirrors HEIGHT_CLASSES in the slideshow / promotion-grid definitions —
 * every key in SLIDER_HEIGHTS must appear for BOTH types, or previewAspect's
 * fallback silently draws the "1/2" shape for the missing one and the canvas
 * lies about what will ship.
 */
const PREVIEW_HEIGHT_SVH: Record<string, Record<string, number>> = {
  slideshow: {
    quarter: 0.3,
    half: 0.5,
    threeFifths: 0.6,
    threeQuarters: 0.7,
    fourFifths: 0.78,
    full: 0.85,
  },
  "promotion-grid": {
    quarter: 0.26,
    half: 0.38,
    threeFifths: 0.45,
    threeQuarters: 0.52,
    fourFifths: 0.6,
    full: 0.7,
  },
};

function previewAspect(
  sectionType: string,
  widthKey: string,
  heightKey: string,
): string {
  const svh = PREVIEW_HEIGHT_SVH[sectionType] ?? PREVIEW_HEIGHT_SVH.slideshow!;
  const width =
    widthKey === "fixed" ? PREVIEW_VIEWPORT.container : PREVIEW_VIEWPORT.width;
  // The full-height width styles override the height panel, like
  // FULL_HEIGHT_CLASS (100svh minus the measured header chrome) does live.
  const height =
    widthKey === "fullHeight" || widthKey === "fullHeightPadding"
      ? PREVIEW_VIEWPORT.height - 80
      : PREVIEW_VIEWPORT.height * (svh[heightKey] ?? svh.half ?? 0.5);
  return `${width} / ${Math.round(height)}`;
}

function StudioCanvas({
  grid,
  sectionType,
  widthKey,
  heightKey,
  blocks,
  categories,
  sliderByHandle,
  tSafe,
  onOpenCell,
  onClearCell,
}: {
  grid: SliderGrid;
  sectionType: string;
  widthKey: string;
  heightKey: string;
  blocks: BlockInstance[];
  categories: CategoryOption[];
  sliderByHandle: Map<string, SliderDocument>;
  tSafe: ReturnType<typeof createTSafe>;
  onOpenCell: (index: number) => void;
  onClearCell: (index: number) => void;
}) {
  return (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: grid.columns,
        gridTemplateRows: grid.rows,
        gridTemplateAreas: grid.areas,
        aspectRatio: previewAspect(sectionType, widthKey, heightKey),
      }}
    >
      {grid.category ? (
        <CategoryRailPreview
          area={grid.category.area}
          categories={categories}
          tSafe={tSafe}
        />
      ) : null}
      {grid.slots.map((area, index) => {
        const block = blocks[index];
        const cell = readSliderCell(block?.settings);
        const filled =
          cell.kind === "image" ? Boolean(cell.image) : Boolean(cell.slider);
        const slider = cell.slider
          ? sliderByHandle.get(cell.slider)
          : undefined;
        return (
          <div
            key={area}
            style={{ gridArea: area }}
            className="relative min-h-0 min-w-0"
          >
            {/* Not a <button>: the cell hosts the live SliderPreview, which
                has buttons of its own, and <button> cannot nest (hydration
                error). Same idiom as the Sliders page card. */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpenCell(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenCell(index);
                }
              }}
              className={cn(
                "group relative flex h-full w-full cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-lg text-center transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filled
                  ? "bg-card hover:ring-2 hover:ring-primary/40"
                  : "bg-[#f5f5f6] hover:ring-2 hover:ring-primary/30 dark:bg-muted/60",
              )}
            >
              {cell.kind === "image" && cell.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cell.image}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : slider ? (
                <>
                  {/* The REAL storefront component, same as the Sliders
                      page's preview — what the cell shows cannot drift from
                      what ships. Click-through: the cell opens the picker. */}
                  <span className="pointer-events-none absolute inset-0">
                    <SliderPreview
                      slider={slider}
                      className="h-full w-full rounded-lg aspect-auto"
                    />
                  </span>
                  <span className="absolute bottom-1.5 start-1.5 max-w-[80%] truncate rounded-md bg-background/85 px-2 py-0.5 text-xs font-medium shadow-sm">
                    {slider.name}
                  </span>
                </>
              ) : cell.slider ? (
                // The stored handle's slider was deleted — keep it visible
                // (and replaceable) instead of silently blank.
                <span className="max-w-full truncate px-3 text-sm font-medium text-amber-600 dark:text-amber-400">
                  {cell.slider}
                </span>
              ) : (
                <AddSliderMark tSafe={tSafe} />
              )}
            </div>
            {filled ? (
              <button
                type="button"
                onClick={() => onClearCell(index)}
                aria-label={tSafe(
                  "admin.storeBuilder.sliderBlock.removeContent",
                  "Remove content",
                )}
                className="absolute end-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-red-600 dark:hover:text-red-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The Figma empty-cell mark: pastel plate with flanking slide bars. */
function AddSliderMark({
  tSafe,
}: {
  tSafe: ReturnType<typeof createTSafe>;
}) {
  return (
    <>
      <span className="flex items-center gap-1.5">
        <span className="h-5 w-1.5 rounded-sm bg-orange-200/60 dark:bg-orange-300/20" />
        <span className="h-8 w-3 rounded-sm bg-orange-200/80 dark:bg-orange-300/30" />
        <span className="grid h-12 w-16 place-items-center rounded-md bg-gradient-to-b from-red-200 to-orange-200 dark:from-red-300/40 dark:to-orange-300/40">
          <ImagePlus className="h-5 w-5 text-white" />
        </span>
        <span className="h-8 w-3 rounded-sm bg-orange-200/80 dark:bg-orange-300/30" />
        <span className="h-5 w-1.5 rounded-sm bg-orange-200/60 dark:bg-orange-300/20" />
      </span>
      <span className="text-sm font-semibold text-muted-foreground">
        {tSafe("admin.storeBuilder.sliderBlock.addSlider", "Add Slider")}
      </span>
    </>
  );
}

/**
 * The category-bar grids' fixed cell, wearing the storefront rail's exact
 * treatment (`components/store/sections/category-rail-card.tsx`) — same
 * panel, hairline, metrics, and type — so the editor previews the real
 * thing. A preview, not an editor: the list always follows the catalog.
 */
function CategoryRailPreview({
  area,
  categories,
  tSafe,
}: {
  area: string;
  categories: CategoryOption[];
  tSafe: ReturnType<typeof createTSafe>;
}) {
  return (
    <div
      style={{ gridArea: area }}
      className={cn(RAIL_PANEL_CLASS, "min-h-0 rounded-[10px]")}
      title={tSafe(
        "admin.storeBuilder.sliderBlock.categoryRailHint",
        "Shows your top categories automatically.",
      )}
    >
      {categories.length > 0 ? (
        <ul className={RAIL_LIST_CLASS}>
          {categories.map((category) => (
            <li key={category._id} className={RAIL_ROW_CLASS}>
              <span className={RAIL_LINK_CLASS}>
                <span className={RAIL_ICON_CLASS}>
                  {category.icon || category.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(category.icon || category.image) as string}
                      alt=""
                      className="h-[22px] w-[22px] rounded-sm object-contain"
                    />
                  ) : (
                    <Package className="h-[21px] w-[21px]" aria-hidden />
                  )}
                </span>
                <span className="truncate">{category.name}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="grid h-full place-items-center px-2 text-center text-xs text-muted-foreground">
          {tSafe(
            "admin.storeBuilder.sliderBlock.categoryRail",
            "Category list",
          )}
        </span>
      )}
    </div>
  );
}

// ---- cell content dialog --------------------------------------------------

function CellContentDialog({
  state,
  onStateChange,
  sectionId,
  sectionType,
  locale,
  blocks,
  sliders,
  slidersHref,
  manageLabel,
  onAssignSlider,
  onPatchCell,
  tSafe,
}: {
  state: { index: number; mode: "choose" | "sliders" | "image" };
  onStateChange: (
    next: { index: number; mode: "choose" | "sliders" | "image" } | null,
  ) => void;
  sectionId: string;
  sectionType: string;
  locale: string;
  blocks: BlockInstance[];
  sliders: SliderDocument[] | null;
  slidersHref: string;
  manageLabel: string;
  onAssignSlider: (index: number, handle: string) => void;
  onPatchCell: (index: number, patch: Record<string, unknown>) => void;
  tSafe: ReturnType<typeof createTSafe>;
}) {
  const cell = readSliderCell(blocks[state.index]?.settings);
  const title =
    state.mode === "sliders"
      ? tSafe("admin.storeBuilder.sliderBlock.pickSlider", "Pick a slider")
      : state.mode === "image"
        ? tSafe("admin.storeBuilder.sliderBlock.cellImage", "Image")
        : tSafe(
            "admin.storeBuilder.sliderBlock.cellTitle",
            "Add slider content",
          );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onStateChange(null);
      }}
    >
      <DialogContent
        className={cn(
          "max-h-[85vh] overflow-y-auto",
          // The slider list shows REAL previews — give them room: near the
          // full viewport, two wide tiles per row, the rest scrolling below.
          state.mode === "sliders"
            ? "sm:max-w-[min(110rem,calc(100vw-4rem))]"
            : "sm:max-w-xl",
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state.mode !== "choose" ? (
              <button
                type="button"
                onClick={() => onStateChange({ ...state, mode: "choose" })}
                aria-label={tSafe("admin.storeBuilder.sliderBlock.back", "Back")}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            {title}
          </DialogTitle>
        </DialogHeader>

        {state.mode === "choose" ? (
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                {
                  key: "image",
                  icon: ImageIcon,
                  label: tSafe(
                    "admin.storeBuilder.sliderBlock.cellImage",
                    "Image",
                  ),
                  hint: tSafe(
                    "admin.storeBuilder.sliderBlock.cellImageHint",
                    "A static picture, optionally linked.",
                  ),
                },
                {
                  key: "sliders",
                  icon: GalleryHorizontalEnd,
                  label: tSafe(
                    "admin.storeBuilder.sliderBlock.cellSlider",
                    "Slider",
                  ),
                  hint: tSafe(
                    "admin.storeBuilder.sliderBlock.cellSliderHint",
                    "A saved slider from the Sliders page.",
                  ),
                },
              ] as const
            ).map(({ key, icon: Icon, label, hint }) => (
              <button
                key={key}
                type="button"
                onClick={() => onStateChange({ ...state, mode: key })}
                className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-6 text-center transition-colors hover:border-primary/60 hover:bg-accent/40"
              >
                <span className="grid h-11 w-11 place-items-center rounded-md bg-accent text-foreground">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
        ) : state.mode === "sliders" ? (
          <div className="space-y-3">
            {sliders === null ? null : sliders.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {tSafe(
                  "admin.storeBuilder.sliderBlock.noSliders",
                  "No sliders yet — create one on the Sliders page.",
                )}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {sliders.map((option) => (
                  // Not a <button>: the tile hosts the live SliderPreview,
                  // which has buttons of its own, and <button> cannot nest
                  // (hydration error). Same idiom as the Sliders page card.
                  <div
                    key={String(option._id ?? option.handle)}
                    role="button"
                    tabIndex={0}
                    onClick={() => onAssignSlider(state.index, option.handle)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onAssignSlider(state.index, option.handle);
                      }
                    }}
                    aria-pressed={cell.slider === option.handle}
                    className={cn(
                      "flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      cell.slider === option.handle
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-primary/60 hover:bg-accent/40",
                    )}
                  >
                    {/* The real storefront component, exactly as the
                        Sliders page previews it — never a stand-in. */}
                    <span className="pointer-events-none block">
                      <SliderPreview
                        slider={option}
                        className="aspect-[16/6] w-full rounded-md"
                      />
                    </span>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {option.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {option.slides.length}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Button asChild type="button" variant="outline" className="w-full">
              <Link href={slidersHref} target="_blank">
                {manageLabel}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <SectionImageField
              value={cell.kind === "image" ? cell.image : ""}
              onChange={(url) =>
                onPatchCell(state.index, { kind: "image", image: url })
              }
              context={{
                locale,
                sectionType,
                sectionId,
                blockType: "cell",
                blockId: blocks[state.index]?.id,
                blockIndex: state.index,
              }}
              uploadTitle={tSafe(
                "admin.storeBuilder.imageUploadTitle",
                "Drag and drop an image, or click to browse",
              )}
              previewAspectRatio="16 / 9"
            />
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {tSafe("admin.storeBuilder.fields.link", "Link")}
              </span>
              <Input
                value={cell.link}
                onChange={(event) =>
                  onPatchCell(state.index, {
                    kind: "image",
                    link: event.target.value,
                  })
                }
                placeholder={tSafe(
                  "admin.storeBuilder.linkPlaceholder",
                  "/products or https://…",
                )}
              />
            </label>
            <Button
              type="button"
              className="w-full"
              onClick={() => onStateChange(null)}
            >
              {tSafe("admin.storeBuilder.sliderBlock.done", "Done")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
