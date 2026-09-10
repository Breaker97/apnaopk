"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Desktop column choices, in the toolbar's icon order. */
const DENSITIES = [2, 3, 4] as const;
type Density = (typeof DENSITIES)[number];

/**
 * The Electronics listing frame: the design's toolbar — dot-matrix density
 * toggles on the left, the sort pill on the right — above the grid.
 *
 * Density is a view preference, not a filter, so it stays client-side and
 * out of the URL. It reaches the server-rendered grid through the
 * `--listing-cols` CSS variable this wrapper sets; the grid opts in with a
 * `lg:grid-cols-[repeat(var(--listing-cols,4),...)]` class, so the server
 * markup never changes and toggling re-renders nothing but styles.
 *
 * Below lg the whole toolbar goes: the responsive column count already
 * decides density there, and the phone shows `sort` in the listing's mobile
 * filter toolbar rather than alone on a row of its own. Pages that render
 * this shell must pass their own phone-width sort control there.
 */
export function ElectronicsListingShell({
  sort,
  viewLabel,
  children,
}: {
  /** The sort control, passed in so the server page owns its labels. */
  sort: ReactNode;
  /** Translated accessible prefix for the density buttons. */
  viewLabel: string;
  children: ReactNode;
}) {
  const [density, setDensity] = useState<Density>(4);

  return (
    <div>
      {/* Desktop only: the density toggles are, and the sort pill's phone
          counterpart rides <ProductsMobileToolbar> beside the filter trigger
          instead. Left in the flow below lg, this row was a rule holding one
          pill pushed to its end. */}
      <div className="mb-6 hidden items-center justify-between gap-4 border-b border-border/70 pb-4 lg:flex">
        <div className="flex items-center gap-[18px]">
          {DENSITIES.map((cols) => (
            <button
              key={cols}
              type="button"
              aria-label={`${viewLabel}: ${cols}`}
              aria-pressed={density === cols}
              onClick={() => setDensity(cols)}
              className="cursor-pointer p-0.5"
            >
              <DensityDots cols={cols} active={density === cols} />
            </button>
          ))}
        </div>
        <div className="ms-auto">{sort}</div>
      </div>

      <div style={{ "--listing-cols": density } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

/**
 * The design's density glyphs are literal dot matrices, so they are drawn as
 * dots rather than approximated with a lucide grid outline. Three rows deep
 * like the mock, except the 2-column mark which the design draws 2×2.
 */
function DensityDots({ cols, active }: { cols: Density; active: boolean }) {
  const rows = cols === 2 ? 2 : 3;
  const dot = cols === 2 ? "size-[6px]" : cols === 3 ? "size-[4.5px]" : "size-[4px]";
  return (
    <span
      className="grid gap-[2px]"
      style={{ gridTemplateColumns: `repeat(${cols}, max-content)` }}
      aria-hidden
    >
      {Array.from({ length: cols * rows }).map((_, index) => (
        <span
          key={index}
          className={cn(
            "rounded-[1.5px] transition-colors",
            dot,
            active ? "bg-foreground" : "bg-muted-foreground/35",
          )}
        />
      ))}
    </span>
  );
}
