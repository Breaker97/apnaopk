import "server-only";

import type { CSSProperties } from "react";
import Link from "@/components/language/link";
import { AppImage } from "@/components/ui/app-image";
import { SavedSliderLazy as SavedSlider } from "@/components/store/saved-slider-lazy";
import {
  CategoryRailCard,
  CategoryRailChips,
} from "@/components/store/sections/category-rail-card";
import {
  isExternalSectionHref,
  resolveSectionHref,
} from "@/components/store/sections/section-shell";
import type { DrawnGridCell } from "@/lib/storefront/section-data/slider-cells";
import { cn } from "@/lib/utils";
import type { Locale } from "@/config/i18n.config";
import type { SliderGrid } from "./slider-grids";

/**
 * The grid-of-cells renderer, shared by every section built that way — the
 * Hero Slider and the Promotion Grid today.
 *
 * A cell holds either a saved Slider or a static linked image, and the two
 * sections differ only in the frame they hang the grid in (their own width
 * and height rules). Keeping ONE implementation here is what stops them
 * drifting: the empty-cell plate, the external link handling and the
 * category rail are all decided once. What each cell draws is resolved by
 * `resolveGridCells` (lib/storefront/section-data/slider-cells.ts), which the
 * shopper app's home reads too.
 */

interface SectionGridProps {
  grid: SliderGrid;
  /** Cells in slot order, as `resolveGridCells` resolved them. */
  cells: DrawnGridCell[];
  locale: Locale;
  /** Height utility for the grid box (the section owns the vocabulary). */
  heightClass?: string;
  /** Corner treatment, which the section's width setting decides. */
  roundedClass?: string;
  /**
   * Spacing as the section set it: px between cells (phones take a little
   * less) and the cells' corners as a CSS length. Either replaces the
   * shipped class above; unset keeps it.
   */
  gap?: number;
  radius?: string;
  className?: string;
  /**
   * Count slide views and clicks against the slider's handle. Off for a
   * vendor's sliders: the counters are keyed by the store's own handles, and
   * a vendor handle of the same name would be counted as the store's.
   */
  trackSliders?: boolean;
}

/**
 * The gap and corners as custom properties: static classes read them, with
 * the shipped values as fallbacks, so the markup never depends on the
 * viewport.
 */
function spacingVars(gap?: number, radius?: string): CSSProperties | undefined {
  if (gap === undefined && radius === undefined) return undefined;
  const vars: Record<string, string> = {};
  if (gap !== undefined) {
    vars["--hs-gap"] = `${gap}px`;
    vars["--hs-gap-m"] = `${Math.round(gap * 0.85)}px`;
  }
  if (radius !== undefined) vars["--hs-radius"] = radius;
  return vars as CSSProperties;
}

const GRID_GAP_CLASS = "gap-[var(--hs-gap-m,0.75rem)] lg:gap-[var(--hs-gap,0.875rem)]";

export function SectionGrid({
  grid,
  cells,
  locale,
  heightClass,
  roundedClass = "rounded-xl",
  gap,
  radius,
  className,
  trackSliders = true,
}: SectionGridProps) {
  const corners = radius === undefined ? roundedClass : "rounded-[var(--hs-radius)]";

  // The cell's SHAPE is the grid's business, not the frame's: `.hs-grid`
  // states a ratio per slot per breakpoint (globals.css), so one wide cell
  // and the squares beside it can differ on a phone.
  const cellFrame = cn("relative overflow-hidden", corners);

  const cellNode = (area: string, index: number) => {
    const cell = cells[index];
    // Slot "a" is the stage — full width until the grid splits at md. Every
    // other slot pairs up on a phone already, so it never needs a 100vw file.
    const sizes =
      area === "a"
        ? "(max-width: 767px) 100vw, 50vw"
        : "(max-width: 1023px) 50vw, 33vw";

    if (cell?.kind === "image") {
      const body = (
        <AppImage
          src={cell.image}
          alt={cell.alt}
          fill
          className="object-cover"
          sizes={sizes}
        />
      );
      if (!cell.link) {
        return (
          <div key={area} data-hs-area={area} className={cellFrame}>
            {body}
          </div>
        );
      }
      const href = resolveSectionHref(locale, cell.link);
      return isExternalSectionHref(cell.link) ? (
        <a
          key={area}
          data-hs-area={area}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cellFrame}
        >
          {body}
        </a>
      ) : (
        <Link key={area} data-hs-area={area} href={href} className={cellFrame}>
          {body}
        </Link>
      );
    }

    if (cell?.kind === "slider") {
      const { slider } = cell;
      return (
        <div key={area} data-hs-area={area} className={cellFrame}>
          <SavedSlider
            slides={cell.slides}
            className={cn("h-full w-full aspect-auto", corners)}
            transition={slider.transition}
            controls={slider.controls}
            handle={trackSliders ? slider.handle : undefined}
            autoplayDelayMs={slider.autoplaySeconds * 1000}
          />
        </div>
      );
    }

    // Unassigned (or unresolvable, or out of live slides) cell: a quiet
    // plate, never a hole — the grid's proportions hold whatever is missing.
    return (
      <div key={area} data-hs-area={area} className={cn(cellFrame, "bg-muted")} />
    );
  };

  return (
    <>
      {/* The rail's column only exists from lg — below that the departments
          ride above the hero as a scrollable chip row rather than
          disappearing, which is what a `hidden lg:block` cell did to the
          store's whole category entry point on a phone. */}
      {grid.category ? (
        <CategoryRailChips locale={locale} className="mb-3 lg:hidden" />
      ) : null}
      <div
        className={cn(
          "hs-grid",
          GRID_GAP_CLASS,
          `hs-grid--${grid.key}`,
          heightClass,
          className,
        )}
        style={spacingVars(gap, radius)}
      >
        {grid.category ? (
          <div data-hs-area={grid.category.area} className="hidden lg:block">
            <CategoryRailCard locale={locale} />
          </div>
        ) : null}
        {grid.slots.map((area, index) => cellNode(area, index))}
      </div>
    </>
  );
}

/** The matching loading frame — same shape, no content. */
export function SectionGridSkeleton({
  grid,
  heightClass,
  roundedClass = "rounded-xl",
  gap,
  radius,
}: {
  grid: SliderGrid;
  heightClass?: string;
  roundedClass?: string;
  gap?: number;
  radius?: string;
}) {
  const corners = radius === undefined ? roundedClass : "rounded-[var(--hs-radius)]";
  return (
    <>
      {grid.category ? (
        <div className="mb-3 flex gap-2 lg:hidden">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="h-10 w-28 shrink-0 animate-pulse rounded-full bg-skeleton"
            />
          ))}
        </div>
      ) : null}
      <div
        className={cn("hs-grid", GRID_GAP_CLASS, `hs-grid--${grid.key}`, heightClass)}
        style={spacingVars(gap, radius)}
      >
        {grid.category ? (
          <div
            data-hs-area={grid.category.area}
            className={cn("hidden animate-pulse bg-skeleton lg:block", corners)}
          />
        ) : null}
        {grid.slots.map((area) => (
          <div
            key={area}
            data-hs-area={area}
            className={cn("animate-pulse bg-skeleton", corners)}
          />
        ))}
      </div>
    </>
  );
}
