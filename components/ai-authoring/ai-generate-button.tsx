"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shared AI brand icon for content-authoring actions (Generate / Improve).
 *  Swapping this single file updates every AI authoring button. AI Studio
 *  passes its own `icon`, so it is not affected by this. */
const AI_ICON_SRC = "/Ai button.png";

type AiGenerateButtonProps = {
  label?: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  /** Render just the AI icon as a compact, borderless square button (no text). */
  iconOnly?: boolean;
  /** Optional leading icon; defaults to the AI brand image. */
  icon?: ReactNode;
  onClick: () => void;
};

export function AiGenerateButton({
  label = "Generate",
  loading = false,
  disabled = false,
  className,
  iconOnly = false,
  icon,
  onClick,
}: AiGenerateButtonProps) {
  const glyph = loading ? (
    <Loader2
      className={cn("animate-spin", iconOnly ? "h-5 w-5" : "h-3.5 w-3.5")}
    />
  ) : (
    icon ?? (
      <Image
        src={AI_ICON_SRC}
        alt=""
        aria-hidden
        width={iconOnly ? 26 : 18}
        height={iconOnly ? 26 : 18}
        className={cn("shrink-0", iconOnly ? "h-[26px] w-[26px]" : "h-[18px] w-[18px]")}
      />
    )
  );

  if (iconOnly) {
    return (
      <button
        type="button"
        disabled={disabled || loading}
        onClick={onClick}
        aria-label={`AI ${label}`}
        title={`AI ${label}`}
        className={cn(
          "inline-grid h-7 w-7 shrink-0 place-items-center rounded-md transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        {glyph}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || loading}
      onClick={onClick}
      className={cn("h-7 gap-1.5 px-2 text-xs", className)}
      aria-label={`AI ${label}`}
      title={`AI ${label}`}
    >
      {glyph}
      {label}
    </Button>
  );
}
