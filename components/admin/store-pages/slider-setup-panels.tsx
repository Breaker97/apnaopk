"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { cn } from "@/lib/utils";
import {
  SLIDER_GRIDS,
  SLIDER_HEIGHTS,
  SLIDER_WIDTHS,
  getSliderGrid,
  type SliderGrid,
} from "@/lib/storefront/sections/slider-grids";

type TSafe = ReturnType<typeof createTSafe>;

/**
 * The Hero Slider's three setup panels — "Pick a Slider Grid / Width Style /
 * Height Style" from the Figma. One component serves both places they
 * appear: the add-section wizard inside the section picker, and the Grid /
 * Width / Height buttons of the studio (there each opens as its own dialog,
 * preselecting the stored choice).
 */
export type SliderSetupKind = "grid" | "width" | "height";

export function sliderSetupTitle(kind: SliderSetupKind, tSafe: TSafe): string {
  switch (kind) {
    case "grid":
      return tSafe(
        "admin.storeBuilder.sliderBlock.gridTitle",
        "Pick a Slider Grid",
      );
    case "width":
      return tSafe(
        "admin.storeBuilder.sliderBlock.widthTitle",
        "Pick a Slider Width Style",
      );
    case "height":
      return tSafe(
        "admin.storeBuilder.sliderBlock.heightTitle",
        "Pick a Slider Height Style",
      );
  }
}

function sliderOptionLabel(
  kind: SliderSetupKind,
  key: string,
  fallback: string,
  tSafe: TSafe,
): string {
  const ns = kind === "grid" ? "grids" : kind === "width" ? "widths" : "heights";
  return tSafe(`admin.storeBuilder.sliderBlock.${ns}.${key}`, fallback);
}

/** The mini "browser chrome" strip every Figma thumbnail wears. */
function ThumbChrome() {
  return (
    <div className="flex items-center justify-between gap-1.5 px-0.5">
      <span className="h-1.5 w-5 shrink-0 rounded-full bg-foreground/25" />
      <span className="flex flex-1 items-center justify-center gap-1">
        {Array.from({ length: 4 }, (_, index) => (
          <span
            key={index}
            className="h-1 w-4 rounded-full bg-foreground/15"
          />
        ))}
      </span>
      <span className="h-1.5 w-4 shrink-0 rounded-full bg-foreground/25" />
    </div>
  );
}

const CELL_TONE = "rounded-[3px] bg-foreground/25";
const CATEGORY_TONE = "rounded-[3px] bg-indigo-400/80";

function GridThumb({ grid }: { grid: SliderGrid }) {
  // The real templates size the category rail with a minmax() pixel minimum
  // (e.g. minmax(220px, 1fr)) — wider than this whole thumbnail, so the rail
  // would blow out of the tile. Collapse each minmax() to its flexible max
  // so the thumb keeps the grid's proportions at miniature scale.
  const thumbColumns = grid.columns.replace(
    /minmax\([^,]+,\s*([^)]+)\)/g,
    "$1",
  );
  return (
    <div className="space-y-1.5">
      <ThumbChrome />
      <div
        className="grid h-14 gap-1"
        style={{
          gridTemplateColumns: thumbColumns,
          gridTemplateRows: grid.rows,
          gridTemplateAreas: grid.areas,
        }}
      >
        {grid.category ? (
          <span
            className={CATEGORY_TONE}
            style={{ gridArea: grid.category.area }}
          />
        ) : null}
        {grid.slots.map((area) => (
          <span key={area} className={CELL_TONE} style={{ gridArea: area }} />
        ))}
      </div>
    </div>
  );
}

function WidthThumb({ styleKey }: { styleKey: string }) {
  const tall = styleKey === "fullHeight" || styleKey === "fullHeightPadding";
  const padded = styleKey === "fullPadding" || styleKey === "fullHeightPadding";
  const contained = styleKey === "fixed";
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        // Full-bleed styles let the plate reach this frame's edges; the
        // chrome keeps its own inset so it reads as the page header.
        contained ? "px-2" : padded ? "px-1" : "px-0",
      )}
    >
      <div className={cn(contained ? "" : padded ? "px-1" : "px-2")}>
        <ThumbChrome />
      </div>
      <div
        className={cn(
          "w-full rounded-[3px] bg-foreground/25",
          tall ? "h-14 rounded-b-none" : "h-9",
          contained && "mx-auto w-[72%]",
        )}
      />
    </div>
  );
}

const HEIGHT_STEPS: Record<string, string> = {
  full: "h-14",
  fourFifths: "h-12",
  threeQuarters: "h-11",
  threeFifths: "h-9",
  half: "h-7",
  quarter: "h-4",
};

function HeightThumb({ styleKey }: { styleKey: string }) {
  return (
    <div className="flex h-[4.75rem] flex-col gap-1.5">
      <ThumbChrome />
      <div
        className={cn(
          "w-full rounded-[3px] bg-foreground/25",
          HEIGHT_STEPS[styleKey] ?? "h-7",
        )}
      />
    </div>
  );
}

/** One choice in a setup panel: a thumbnail over a pill label. Exported for
 * the deals panel's layout picker, which offers the same kind of choice. */
export function OptionTile({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-muted/40 p-2.5 text-left transition-colors",
        selected
          ? "border-primary ring-1 ring-primary"
          : "border-border hover:border-primary/60 hover:bg-accent/40",
      )}
    >
      <span className="rounded-md bg-card p-2 shadow-sm">{children}</span>
      <span
        className={cn(
          "mx-auto rounded-md px-2 py-0.5 text-center text-xs font-medium",
          selected
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * One panel of option tiles. `value` highlights the current choice;
 * `onSelect` fires immediately on click (the wizard advances, the studio
 * dialogs apply and close).
 */
export function SliderSetupPanel({
  kind,
  value,
  onSelect,
  tSafe,
  grids = SLIDER_GRIDS,
}: {
  kind: SliderSetupKind;
  value: string | undefined;
  onSelect: (key: string) => void;
  tSafe: TSafe;
  /** Which grids to offer; the promotion grid excludes the category bars. */
  grids?: SliderGrid[];
}) {
  if (kind === "grid") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {grids.map((grid) => (
          <OptionTile
            key={grid.key}
            label={sliderOptionLabel("grid", grid.key, grid.label, tSafe)}
            selected={value === grid.key}
            onSelect={() => onSelect(grid.key)}
          >
            <GridThumb grid={getSliderGrid(grid.key)} />
          </OptionTile>
        ))}
      </div>
    );
  }
  if (kind === "width") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SLIDER_WIDTHS.map((width) => (
          <OptionTile
            key={width.key}
            label={sliderOptionLabel("width", width.key, width.label, tSafe)}
            selected={value === width.key}
            onSelect={() => onSelect(width.key)}
          >
            <WidthThumb styleKey={width.key} />
          </OptionTile>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {SLIDER_HEIGHTS.map((height) => (
        <OptionTile
          key={height.key}
          label={sliderOptionLabel("height", height.key, height.label, tSafe)}
          selected={value === height.key}
          onSelect={() => onSelect(height.key)}
        >
          <HeightThumb styleKey={height.key} />
        </OptionTile>
      ))}
    </div>
  );
}

/**
 * The same panel as its own dialog — what the studio's Grid / Width /
 * Height buttons open, preselecting the stored choice.
 */
export function SliderSetupDialog({
  kind,
  open,
  onOpenChange,
  value,
  onSelect,
  tSafe,
  grids,
}: {
  kind: SliderSetupKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string | undefined;
  onSelect: (key: string) => void;
  tSafe: TSafe;
  grids?: SliderGrid[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{sliderSetupTitle(kind, tSafe)}</DialogTitle>
        </DialogHeader>
        <SliderSetupPanel
          kind={kind}
          grids={grids}
          value={value}
          onSelect={(key) => {
            onSelect(key);
            onOpenChange(false);
          }}
          tSafe={tSafe}
        />
      </DialogContent>
    </Dialog>
  );
}
