"use client";

import type { CSSProperties } from "react";
import { SlideView, type SlideViewLabels } from "@/components/store/slide-view";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import {
  HERO_FRAMES,
  shapeForFrame,
  SLIDE_FRAMES,
  type SlideShape,
  type SliderSlide,
} from "@/lib/sliders/types";

/**
 * The frames this slide lands in on the shop, live, and the way the merchant
 * picks which one to design on.
 *
 * Each is a real `.sl-frame` at its real size, zoomed to a thumbnail, so the
 * container query picks the band the shop would rather than a second copy of
 * the rule. Where the slider is actually placed, these are THAT cell measured
 * at the three viewport widths — which is the only honest answer to "what
 * happens on a tablet": a cell's proportions change with the window, and the
 * same cell can be a wide hero on a desktop and a small tile on a phone.
 *
 * Frames in a group share one zoom, so their sizes read true against each
 * other. Picking one opens the board at that exact frame; the others in its
 * band stay marked, because they take the same design.
 */

export interface BoardFrame {
  key: string;
  width: number;
  height: number;
  /** Desktop / Tablet / Phone, or a band's name when nothing is placed. */
  label: string;
  /** Why this frame cannot be known exactly, when it cannot. */
  assumption?: string;
}

export interface FrameGroup {
  key: string;
  /** Where these frames are: a page and a cell, or nothing when unplaced. */
  title?: string;
  note?: string;
  frames: BoardFrame[];
}

/**
 * The frames to offer when the slider is not on a page yet: the three
 * measured hero frames, plus the two bands a hero never produces. Labels
 * come from the caller, which has the translations.
 */
export const UNPLACED_FRAMES: Omit<BoardFrame, "label">[] = [
  { key: "desktop", ...HERO_FRAMES.desktop },
  { key: "tablet", ...HERO_FRAMES.tablet },
  { key: "tile", ...SLIDE_FRAMES.tile },
  { key: "phone", ...HERO_FRAMES.phone },
  { key: "tall", ...SLIDE_FRAMES.portrait },
];

/** The widest thumbnail in a group, and the tallest, in screen px. */
const MAX_THUMB_W = 188;
const MAX_THUMB_H = 132;

export function SlideFramePicker({
  slide,
  labels,
  bandLabels,
  groups,
  active,
  onPick,
}: {
  slide: SliderSlide;
  labels: SlideViewLabels;
  /** What to call each band. */
  bandLabels: Record<SlideShape, string>;
  groups: FrameGroup[];
  /** The frame the board is currently drawn at. */
  active: { width: number; height: number };
  onPick: (frame: BoardFrame) => void;
}) {
  const { formatPrice } = useCurrency();
  const activeBand = shapeForFrame(active.width, active.height);
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        // One zoom for the whole group, so a phone thumbnail really is a
        // third of the desktop one rather than being blown up to match it.
        const zoom = Math.min(
          MAX_THUMB_W / Math.max(...group.frames.map((f) => f.width)),
          MAX_THUMB_H / Math.max(...group.frames.map((f) => f.height)),
        );
        return (
          <div key={group.key} className="space-y-1.5">
            {group.title ? (
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-foreground">
                {group.title}
                {group.note ? (
                  <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-normal text-muted-foreground">
                    {group.note}
                  </span>
                ) : null}
              </p>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              {group.frames.map((frame) => {
                const band = shapeForFrame(frame.width, frame.height);
                const on = frame.width === active.width && frame.height === active.height;
                // Not the board, but wearing the design the board is editing.
                const sameBand = !on && band === activeBand;
                return (
                  <button
                    key={frame.key}
                    type="button"
                    onClick={() => onPick(frame)}
                    aria-pressed={on}
                    title={frame.assumption}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-[10px] border p-1.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on
                        ? "border-primary bg-primary/5"
                        : sameBand
                          ? "border-primary/30 bg-primary/[0.03]"
                          : "border-transparent hover:border-border hover:bg-accent/50",
                    )}
                  >
                    <span
                      className={cn(
                        "relative block overflow-hidden rounded-[6px] border bg-muted",
                        on ? "border-primary/40" : "border-border",
                      )}
                      style={{ width: frame.width * zoom, height: frame.height * zoom }}
                    >
                      <span
                        className="sl-frame pointer-events-none absolute left-0 top-0 block overflow-hidden"
                        style={
                          {
                            width: frame.width,
                            height: frame.height,
                            transform: `scale(${zoom})`,
                            transformOrigin: "top left",
                          } as CSSProperties
                        }
                      >
                        <SlideView slide={slide} formatPrice={formatPrice} labels={labels} editing />
                      </span>
                    </span>
                    <span className="flex flex-col gap-0.5 px-0.5">
                      <span
                        className={cn(
                          "text-[11px] font-medium leading-none",
                          on ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {frame.label}
                      </span>
                      {/* The size, and the band it therefore lands in — the
                          two facts a device name hides. A frame that cannot
                          be known exactly says so with a tilde. */}
                      <span className="text-[10px] leading-none text-muted-foreground">
                        {frame.assumption ? "~" : ""}
                        {frame.width} × {frame.height} · {bandLabels[band]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
