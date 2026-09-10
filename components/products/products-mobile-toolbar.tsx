"use client";

import type { ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Trigger overrides that turn a `<ProductsSort>` pill into this toolbar's
 * trailing half: no chrome of its own — the row owns the border, the radius
 * and the shadow — and `flex-row-reverse` so the sort mark leads its label the
 * way the sliders icon leads "Filters" in the other half. Logical, so the two
 * halves keep the same reading order in RTL.
 */
export const PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS =
  "w-full flex-row-reverse justify-center rounded-none rounded-e-md border-0 px-3 data-[size=default]:h-11";

/**
 * Filters and sort as one row, for phone-width listings.
 *
 * The two controls reach the page from opposite ends: the filter sheet's
 * trigger from the sidebar component, the sort from the listing toolbar —
 * whose other half, the density toggles, is desktop-only. So below `lg` that
 * toolbar rendered as a rule carrying nothing but a lone pill pushed to its
 * end, stacked under a full-width "Filters" button: two rows of chrome before
 * a shopper saw a product.
 *
 * One bordered control split down the middle spends that height once. Each
 * half is 44px rather than the 36px both inherited from their desktop selves,
 * which is also the touch-target floor they were under.
 *
 * With no `sort` the row is a single full-width half — the shape a listing
 * whose sort lives elsewhere on the page still wants.
 */
export function ProductsMobileToolbar({
  filtersLabel,
  activeCount = 0,
  onOpenFilters,
  sort,
  className,
}: {
  filtersLabel: string;
  /**
   * Facets in force. Shown as a badge because the sheet is closed: on a phone
   * it is the only thing telling a shopper why the grid is short.
   */
  activeCount?: number;
  onOpenFilters: () => void;
  /** A `<ProductsSort>` carrying `PRODUCTS_MOBILE_TOOLBAR_SORT_CLASS`. */
  sort?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-5 grid rounded-md border bg-background shadow-xs lg:hidden",
        sort ? "grid-cols-2" : "grid-cols-1",
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpenFilters}
        className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-s-md text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        {filtersLabel}
        {activeCount > 0 ? (
          <Badge className="px-1.5">{activeCount}</Badge>
        ) : null}
      </button>

      {/* The divider rides the sort half rather than sitting between the two
          as an element of its own, so the row stays exactly two columns. */}
      {sort ? <div className="flex border-s border-border">{sort}</div> : null}
    </div>
  );
}
