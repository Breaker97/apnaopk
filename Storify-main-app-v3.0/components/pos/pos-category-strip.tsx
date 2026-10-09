"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRailEdges } from "@/components/store/scroll-rail";
import { cn } from "@/lib/utils";
import type { POSCategory } from "@/components/pos/pos-types";

/**
 * The POS category pills. A catalogue with a dozen categories is far wider
 * than the product panel, so the row scrolls on its own box: a swipe on touch
 * tills, the wheel or the arrows with a mouse. It used to sit in `ScrollArea`,
 * which mounts only a vertical scrollbar — Radix then pins the viewport to
 * `overflow-x: hidden`, and every pill past the panel edge was unreachable.
 *
 * The arrows and the edge fade come from the same measure, so they appear
 * only on the side that actually hides pills. Both are physical (left/right):
 * `useRailEdges` already did the RTL arithmetic, and `scrollBy` with a
 * negative `left` moves physically left in either direction.
 */
export function POSCategoryStrip({
  categories,
  selectedCategory,
  onSelect,
}: {
  categories: POSCategory[];
  selectedCategory: string;
  onSelect: (categoryId: string) => void;
}) {
  const t = useTranslations();
  const railRef = React.useRef<HTMLDivElement>(null);
  const { edges, measure } = useRailEdges(railRef);

  const scrollByPage = (direction: -1 | 1) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.floor(el.clientWidth * 0.7),
      behavior: "smooth",
    });
  };

  // A mouse wheel only scrolls vertically, and this row has nowhere to go
  // vertically — so a vertical notch turns the row instead of doing nothing.
  // Trackpads already send deltaX and are left alone. In RTL the row starts
  // at scrollLeft 0 and runs negative, so the wheel's sign flips.
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (el.scrollWidth <= el.clientWidth) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollLeft += rtl ? -event.deltaY : event.deltaY;
  };

  // Keep the picked pill in view: choosing a category from the far end of a
  // long row should not leave the active pill half under an arrow. Measured
  // by hand rather than `scrollIntoView`, which would also scroll the POS
  // shell's `overflow-hidden` ancestors and shift the whole terminal.
  React.useEffect(() => {
    const el = railRef.current;
    const active = el?.querySelector<HTMLElement>("[aria-pressed='true']");
    if (!el || !active) return;
    const rail = el.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    // Clear of the 32px arrow plus its 8px inset.
    const inset = 44;
    const delta =
      box.left < rail.left + inset
        ? box.left - rail.left - inset
        : box.right > rail.right - inset
          ? box.right - rail.right + inset
          : 0;
    if (delta) el.scrollBy({ left: delta, behavior: "smooth" });
  }, [selectedCategory]);

  const pill = (active: boolean) =>
    cn(
      "shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
    );

  const arrow =
    "absolute top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground sm:flex";

  return (
    <div className="relative shrink-0 bg-card">
      <div
        ref={railRef}
        data-rail
        onScroll={measure}
        onWheel={onWheel}
        className="flex gap-1 overflow-x-auto overscroll-x-contain px-3 pb-2.5 pt-2.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-5 sm:pb-3 sm:pt-4 [&::-webkit-scrollbar]:hidden"
      >
        <button
          type="button"
          aria-pressed={selectedCategory === ""}
          onClick={() => onSelect("")}
          className={pill(selectedCategory === "")}
        >
          {t("pos.allProducts")}
        </button>
        {categories.map((cat) => (
          <button
            key={cat._id}
            type="button"
            aria-pressed={selectedCategory === cat._id}
            onClick={() =>
              onSelect(selectedCategory === cat._id ? "" : cat._id)
            }
            className={pill(selectedCategory === cat._id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Pointer-only: a phone swipes, and the fade already says the row
          continues. From sm the rail's top padding outgrows its bottom, so the
          arrow drops 2px to stay centred on the pills. */}
      {edges.left && (
        <button
          type="button"
          onClick={() => scrollByPage(-1)}
          aria-label={t("home.scrollLeft")}
          className={cn(arrow, "left-2 sm:mt-0.5")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          onClick={() => scrollByPage(1)}
          aria-label={t("home.scrollRight")}
          className={cn(arrow, "right-2 sm:mt-0.5")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
