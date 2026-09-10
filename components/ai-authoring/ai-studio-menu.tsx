"use client";

/**
 * AiStudioMenu — the "AI Studio" launcher with a hover preview.
 *
 * Interaction model:
 *  - Hovering the AI Studio button opens a preview that teases what the studio
 *    can do (remove background, enhance, upscale, describe an edit).
 *  - Moving the mouse off the button closes the preview again.
 *  - The preview is non-interactive (pointer-events: none) — it never captures
 *    a click. Only the button is clickable, which opens the AI Studio.
 *
 * The preview is purely illustrative — it shows a fixed demo product image
 * (`/public/shoe.png`), not the user's own media. Only the closing line adapts
 * to the surface, via `subjectNoun`.
 */

import { useState } from "react";
import Image from "next/image";
import { ArrowUp, ImageOff, Maximize2, Wand2 } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { AiStudioButton } from "@/components/ai-authoring/ai-studio-button";

// Rainbow frame matching the AI Studio reference: cyan across the top, hot-pink
// at the bottom-left and warm orange at the bottom-right. Stops sit at this wide
// box's corner angles (~2.9:1) so the hues land on the correct corners, and the
// side transitions pass through bright teal / violet rather than muddy grey.
const AI_GRADIENT =
  "conic-gradient(from 0deg at 50% 50%, #3dd8e6 0deg, #3dd8e6 70deg, #86d69c 96deg, #ffb45c 110deg, #ffa860 152deg, #ff6f8e 192deg, #ff2f9e 240deg, #ff62b2 256deg, #c98fd6 276deg, #3dd8e6 290deg, #3dd8e6 360deg)";

type AiStudioMenuProps = {
  /** Open the actual AI Studio (button click only). */
  onOpenStudio: () => void;
  disabled?: boolean;
  className?: string;
  /** Accessible name / tooltip for the trigger. */
  label?: string;
  /** What the image depicts, used in the preview copy: "Your ___ stays unchanged". */
  subjectNoun?: string;
  /**
   * Rendered height of the branded pill, in px. Compact surfaces — the mega
   * menu's promo slots sit in a 25px action strip — scale it down rather than
   * swapping in their own button, so the launcher stays the same everywhere.
   */
  height?: number;
};

export function AiStudioMenu({
  onOpenStudio,
  disabled = false,
  className,
  label,
  subjectNoun = "product",
  height,
}: AiStudioMenuProps) {
  const [open, setOpen] = useState(false);

  const handleOpenStudio = () => {
    setOpen(false);
    onOpenStudio();
  };

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen} modal={false}>
      <PopoverAnchor asChild>
        {/* Hover to open; moving off the button closes it again. */}
        <span
          className="inline-flex"
          onMouseEnter={() => !disabled && setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <AiStudioButton
            onClick={handleOpenStudio}
            disabled={disabled}
            className={className}
            label={label}
            height={height}
          />
        </span>
      </PopoverAnchor>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        // Purely informational: it ignores all pointer events, so it can never
        // be clicked, and moving toward it counts as leaving the button (which
        // closes the preview).
        className="pointer-events-none w-[380px] border-0 bg-transparent p-0 shadow-none"
      >
        <div className="overflow-hidden rounded-xl border bg-popover p-3 shadow-xl">
          {/* Mock studio header — two tabs and a primary action */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-16 rounded-full bg-muted" />
              <span className="h-2.5 w-12 rounded-full bg-muted" />
            </div>
            <span className="h-3 w-28 rounded-full bg-blue-600" />
          </div>

          {/* Demo product image the studio would work on */}
          <div className="mt-3 overflow-hidden rounded-xl bg-muted/50 p-2">
            <Image
              src="/shoe.png"
              alt=""
              aria-hidden
              width={523}
              height={267}
              className="h-auto w-full"
            />
          </div>

          {/* Gradient-framed capability box.
              The border is a real 3px transparent border with the gradient
              painted on the border-box (and the popover fill on the padding-box),
              so the browser renders the frame — corners are always complete,
              unlike a padding + nested-radius trick. */}
          <div
            className="mt-3 overflow-hidden rounded-md shadow-[0_10px_28px_-10px_rgba(255,70,150,0.5)]"
            style={{
              border: "3px solid transparent",
              borderBottomWidth: "12px", // pb-3: bolder gradient band along the bottom
              background: `linear-gradient(var(--popover), var(--popover)) padding-box, ${AI_GRADIENT} border-box`,
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5 text-[11px] font-medium text-foreground/80">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <ImageOff className="h-3.5 w-3.5" />
                Remove Background
              </span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Wand2 className="h-3.5 w-3.5" />
                Enhance
              </span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Maximize2 className="h-3.5 w-3.5" />
                Upscale
              </span>
            </div>
            <div className="flex items-end justify-between gap-3 p-3">
              <p className="text-sm leading-snug text-foreground">
                Remove the background, enhance, or upscale — or just describe the
                edit you want. Your {subjectNoun} stays unchanged.
              </p>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-background">
                <ArrowUp className="h-4 w-4" />
              </span>
             </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
