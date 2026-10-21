"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useClientValue } from "@/hooks/use-client-value";
import {
  CATEGORY_DENSITIES,
  readCategoryDensityCookie,
  saveCategoryDensity,
  type CategoryDensity,
} from "@/lib/storefront/category-density";
import { cn } from "@/lib/utils";

type Variant = "tiles" | "cards";

/** Phone and tablet tiers: not the shopper's choice, so they never change. */
const GRID_BASE: Record<Variant, string> = {
  tiles: "grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6",
  cards: "grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4",
};

/**
 * Static strings so Tailwind's scanner sees them. Denser grids tighten their
 * gap with them, so the tiles shrink instead of the page growing.
 */
const GRID_DENSITY: Record<Variant, Record<CategoryDensity, string>> = {
  tiles: {
    4: "lg:grid-cols-4 lg:gap-[26px]",
    6: "lg:grid-cols-6 lg:gap-5",
    8: "lg:grid-cols-8 lg:gap-4",
  },
  cards: {
    4: "lg:grid-cols-4 lg:gap-5",
    6: "lg:grid-cols-6 lg:gap-4",
    8: "lg:grid-cols-8 lg:gap-3",
  },
};

function readStoredDensity(): CategoryDensity | null {
  return readCategoryDensityCookie(document.cookie);
}

/** Square cell size and its step inside the 20 x 20 glyph box. */
const GLYPH: Record<CategoryDensity, { size: number; step: number; count: number }> = {
  4: { size: 7, step: 9, count: 2 },
  6: { size: 4.6, step: 5.7, count: 3 },
  8: { size: 3.3, step: 4.2, count: 4 },
};

/** A denser grid draws more, smaller squares: 2x2, 3x3, then 4x4. */
function DensityGlyph({ density }: { density: CategoryDensity }) {
  const { size, step, count } = GLYPH[density];
  const cells = Array.from({ length: count }, (_, i) => 2 + i * step);
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      {cells.flatMap((y) =>
        cells.map((x) => (
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width={size}
            height={size}
            rx={size / 4.6}
          />
        )),
      )}
    </svg>
  );
}

/**
 * The all-categories grid with its density switch: "N categories" on the
 * left, a 4 / 6 / 8-per-row segmented control on the right, the grid below.
 *
 * The items stay server-rendered and arrive as children; the grid carries
 * `data-density` and the items restyle themselves from it with
 * `group-data-[density=…]/density:` classes, so no item needs to know the
 * state. The switch is a desktop control: below lg the grid is the fixed 2/3
 * tiers and the control is hidden.
 *
 * The pick is remembered in a cookie. The server reads it into
 * `initialDensity`, so a reload or the next page draws the right columns from
 * the first byte. The browser's own copy is read after hydration too, because
 * Back can restore this page from the router cache with a payload made before
 * the pick was changed.
 */
export function CategoryDensityGrid({
  variant,
  total,
  initialDensity,
  children,
}: {
  variant: Variant;
  /** Categories matching the page's search, across every page. */
  total: number;
  initialDensity: CategoryDensity;
  children: ReactNode;
}) {
  const t = useTranslations("storeCategoriesPage");
  const stored = useClientValue(readStoredDensity, null);
  const [chosen, setChosen] = useState<CategoryDensity | null>(null);
  const density = chosen ?? stored ?? initialDensity;

  const choose = (option: CategoryDensity) => {
    setChosen(option);
    saveCategoryDensity(option);
  };

  return (
    <div>
      <div className="flex min-h-11 items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("count", { count: total })}
        </p>
        <div
          role="group"
          aria-label={t("perRowGroup")}
          className="hidden items-center gap-0.5 rounded-xl bg-muted p-1 lg:flex"
        >
          {CATEGORY_DENSITIES.map((option) => {
            const active = option === density;
            return (
              <button
                key={option}
                type="button"
                aria-label={t("perRow", { count: option })}
                title={t("perRow", { count: option })}
                aria-pressed={active}
                onClick={() => choose(option)}
                className={cn(
                  "grid size-9 place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  active
                    ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/5"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <DensityGlyph density={option} />
              </button>
            );
          })}
        </div>
      </div>

      <div
        data-density={density}
        className={cn(
          "group/density mt-4 grid",
          GRID_BASE[variant],
          GRID_DENSITY[variant][density],
        )}
      >
        {children}
      </div>
    </div>
  );
}
