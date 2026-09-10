"use client";

import { DiagramFrame } from "@/components/admin/online-store/option-card-group";
import { cn } from "@/lib/utils";

/**
 * The picture cards the Layout group keeps: page width and the slider
 * width/height sheets. These are the settings where the picture IS the
 * meaning — everything numeric in the editor is a number input.
 */

export function PageWidthDiagram({ kind }: { kind: string }) {
  const contained = kind !== "full";
  const inset: Record<string, string> = {
    "1200": "px-4",
    "1280": "px-3",
    "1440": "px-2",
    full: "px-0",
  };
  return (
    <DiagramFrame>
      <div className={cn("flex-1", inset[kind] ?? "px-3")}>
        <div
          className={cn(
            "h-8 bg-foreground/25",
            contained ? "rounded-sm" : "rounded-none",
          )}
        />
        <div className={cn("mt-1 flex gap-1", contained ? "" : "px-1")}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-2.5 flex-1 rounded-[2px] bg-foreground/15" />
          ))}
        </div>
      </div>
    </DiagramFrame>
  );
}

export function SliderWidthDiagram({ kind }: { kind: string }) {
  const padded = kind === "fixed" || kind === "fullPadding" || kind === "fullHeightPadding";
  const tall = kind === "fullHeight" || kind === "fullHeightPadding";
  const inset = kind === "fixed" ? "px-3" : padded ? "px-1" : "px-0";
  return (
    <DiagramFrame>
      <div className={cn("flex flex-1 flex-col", inset, tall ? "pb-0" : "pb-2")}>
        <div
          className={cn(
            "bg-foreground/25",
            padded ? "rounded-sm" : "rounded-none",
            tall ? "flex-1" : "h-8",
          )}
        />
      </div>
    </DiagramFrame>
  );
}

export function SliderHeightDiagram({ kind }: { kind: string }) {
  const heights: Record<string, string> = {
    full: "h-full",
    fourFifths: "h-4/5",
    threeQuarters: "h-3/4",
    threeFifths: "h-3/5",
    half: "h-1/2",
    quarter: "h-1/4",
  };
  return (
    <DiagramFrame>
      <div className="flex-1">
        <div className={cn("w-full bg-foreground/25", heights[kind] ?? "h-1/2")} />
      </div>
    </DiagramFrame>
  );
}
