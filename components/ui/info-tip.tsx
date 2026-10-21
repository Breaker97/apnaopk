"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A small (i) beside a figure, for the sentence that explains it.
 *
 * Explanations printed under every row made a balance sheet read like a
 * manual; this keeps them one hover, focus or tap away. A tap toggles it,
 * because a touch screen has no hover to open a tooltip with.
 */
export function InfoTip({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={text}
          onClick={(event) => {
            // Radix closes a tooltip on click; a tap should open it instead.
            event.preventDefault();
            setOpen((current) => !current);
          }}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Info aria-hidden="true" className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6} className="max-w-xs text-pretty">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
