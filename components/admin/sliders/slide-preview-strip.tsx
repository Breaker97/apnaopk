"use client";

import type { CSSProperties } from "react";
import { SlideView, type SlideViewLabels } from "@/components/store/slide-view";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import {
  HERO_FRAMES,
  shapeForFrame,
  type SlideShape,
  type SliderSlide,
} from "@/lib/sliders/types";

/**
 * The slide at the frames it actually lands in on the shop — the desktop,
 * tablet and phone hero, and a square tile — live, as the merchant edits.
 * Each is a real `.sl-frame` at its real size, zoomed to a thumbnail, so the
 * container query picks the band the shop would; clicking one switches the
 * artboard to that band. The three artboards show the bands; this strip
 * shows the frames between and around them.
 */

const FRAMES: { key: string; width: number; height: number; zoom: number }[] = [
  { key: "desktop", ...HERO_FRAMES.desktop, zoom: 0.16 },
  { key: "tablet", ...HERO_FRAMES.tablet, zoom: 0.2 },
  { key: "phone", ...HERO_FRAMES.phone, zoom: 0.36 },
  { key: "tile", width: 600, height: 600, zoom: 0.14 },
];

export function SlidePreviewStrip({
  slide,
  labels,
  frameLabels,
  active,
  onPick,
}: {
  slide: SliderSlide;
  labels: SlideViewLabels;
  frameLabels: Record<string, string>;
  active: SlideShape;
  onPick: (shape: SlideShape) => void;
}) {
  const { formatPrice } = useCurrency();
  return (
    <div className="flex flex-wrap items-end gap-3" aria-label={frameLabels.title}>
      {FRAMES.map((frame) => {
        const shape = shapeForFrame(frame.width, frame.height);
        return (
          <button
            key={frame.key}
            type="button"
            onClick={() => onPick(shape)}
            className={cn(
              "group/frame flex flex-col items-start gap-1 rounded-[8px] p-1 transition hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              shape === active && "bg-accent/70",
            )}
            title={`${frame.width} × ${frame.height}`}
          >
            <span
              className="relative overflow-hidden rounded-[6px] border border-border bg-muted"
              style={{ width: frame.width * frame.zoom, height: frame.height * frame.zoom }}
            >
              <span
                className="sl-frame pointer-events-none absolute left-0 top-0 block overflow-hidden"
                style={
                  {
                    width: frame.width,
                    height: frame.height,
                    transform: `scale(${frame.zoom})`,
                    transformOrigin: "top left",
                  } as CSSProperties
                }
              >
                <SlideView slide={slide} formatPrice={formatPrice} labels={labels} editing />
              </span>
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">
              {frameLabels[frame.key] ?? frame.key}
            </span>
          </button>
        );
      })}
    </div>
  );
}
