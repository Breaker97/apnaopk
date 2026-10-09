"use client";

import { DiagramFrame } from "@/components/admin/online-store/option-card-group";
import { cn } from "@/lib/utils";

/**
 * The picture card the Layout group keeps: page width. This is the setting
 * where the picture IS the meaning — everything numeric in the editor is a
 * number input. A slider's own width and height are set on the section that
 * holds it, beside the cell they size.
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
