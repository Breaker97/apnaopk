import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * "Second image" hover, the shot being replaced: it fades out completely
 * under a hovering pointer, so no part of it shows through the transparent
 * pixels of a cut-out second shot. Tailwind's hover variants only apply
 * where the pointer can hover; reduced motion swaps without the fade.
 */
export const CARD_SWAP_OUT_CLASS =
  "transition-opacity duration-300 motion-reduce:transition-none group-hover:opacity-0";

/** "Second image" hover, the shot swapped in: hidden until the card is hovered. */
export const CARD_SWAP_IN_CLASS =
  "opacity-0 transition-opacity duration-300 motion-reduce:transition-none group-hover:opacity-100";

/**
 * One picture on the card's preview stage, framed the way the stage's Fit
 * says: a contained shot floats inside the stage padding, a covered one
 * bleeds to the edges. The storefront card and the Card Studio preview draw
 * every picture through it, the primary and the "Second image" hover shot
 * alike, so the hover shot lands exactly where the shot it replaces sat —
 * never bigger, cropped or shifted.
 */
export function CardStageLayer({
  contained,
  padding,
  className,
  children,
}: {
  contained: boolean;
  /** Air around a contained shot (px). */
  padding: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("absolute inset-0", className)}
      style={contained ? { padding } : undefined}
    >
      {contained ? (
        <div className="relative h-full w-full">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
