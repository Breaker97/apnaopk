"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * AiStudioButton — the "AI Studio" launcher.
 *
 * The whole button is a single branded image (a gradient pill with the sparkles
 * glyph and the "AI Studio" wordmark baked in). Swap `/public/Ai studio.png` to
 * restyle it everywhere it is used.
 */
const AI_STUDIO_SRC = "/Ai studio.png";
const AI_STUDIO_WIDTH = 512; // native pixel size — keeps the pill undistorted
const AI_STUDIO_HEIGHT = 173;

type AiStudioButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  /** Accessible name / tooltip (the visible label is baked into the image). */
  label?: string;
  /** Rendered height in px; width follows the image's aspect ratio. */
  height?: number;
};

export function AiStudioButton({
  onClick,
  disabled = false,
  className,
  label = "AI Studio",
  height = 30,
}: AiStudioButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 rounded-[10px] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <Image
        src={AI_STUDIO_SRC}
        alt=""
        aria-hidden
        width={AI_STUDIO_WIDTH}
        height={AI_STUDIO_HEIGHT}
        className="w-auto"
        style={{ height }}
      />
    </button>
  );
}
