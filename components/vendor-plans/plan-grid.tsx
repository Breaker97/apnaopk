"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PlanGridProps {
  count: number;
  children: ReactNode;
  className?: string;
}

/**
 * Responsive pricing grid whose column count and max width adapt to how many
 * plans are shown, so rows stay balanced (no lone orphan card) and cards keep a
 * consistent, pleasant width:
 *   1 plan  → single centered card at ~2-column width
 *   2 plans → two columns (wider cards, per the reference design)
 *   3 plans → three columns (one perfect row)
 *   4 plans → two columns → a symmetric 2×2 block instead of a 3+1 orphan
 *   5+      → up to three columns (5 → 3+2, 6 → 3+3, etc.)
 * The grid is centered so partial rows don't hug the left edge. The top
 * padding and the taller row gap leave room for the "Recommended" tag, which
 * sits on a card's top border.
 */
export function PlanGrid({ count, children, className }: PlanGridProps) {
  let columns: string;
  if (count <= 1) {
    columns = "max-w-md grid-cols-1";
  } else if (count === 2) {
    columns = "max-w-3xl grid-cols-1 sm:grid-cols-2";
  } else if (count === 4) {
    // 2×2 keeps every row full; 3-col here would leave a single trailing card.
    columns = "max-w-3xl grid-cols-1 sm:grid-cols-2";
  } else {
    columns = "max-w-5xl grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
  }

  return (
    <div className={cn("mx-auto grid gap-x-4 gap-y-6 pt-3", columns, className)}>
      {children}
    </div>
  );
}
