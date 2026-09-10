"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";

/** Which physical edge of a rail still hides content. */
interface RailEdges {
  left: boolean;
  right: boolean;
}

const NO_EDGES: RailEdges = { left: false, right: false };

/**
 * A horizontal rail that says out loud whether it can still be scrolled.
 *
 * Storefront rows — brand logos, category circles, product carousels — hold
 * more than a phone can show, and a hidden scrollbar leaves the cut item
 * looking like a rendering fault rather than an invitation to swipe. This
 * wrapper measures the real overflow and stamps `data-rail-l` / `data-rail-r`
 * on the scroller; globals.css turns those into an edge fade. The cue is
 * therefore never a guess: it appears only when content is actually cut, on
 * the side it is cut, and it clears when the row reaches that end.
 *
 * The flags are PHYSICAL (left/right), not logical, so the CSS needs no
 * direction handling — the RTL arithmetic is done once, here.
 *
 * Children stay server-rendered: this component only owns the scroll box, so
 * wrapping a server-rendered row costs no client payload beyond the measure.
 */
/**
 * The measurement on its own, for a rail that already owns its scroll box —
 * the category strip draws arrows from the same numbers, and running two
 * observers over one element to answer the same question would be silly.
 *
 * Returns the physical edges that still hide content, and the measure
 * callback the scroller must fire on scroll.
 */
export function useRailEdges<T extends HTMLElement>(
  ref: RefObject<T | null>,
): { edges: RailEdges; measure: () => void } {
  const [edges, setEdges] = useState<RailEdges>(NO_EDGES);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // In RTL `scrollLeft` runs from -max (scrolled to the physical left) to 0,
    // so the two sides swap; a couple of pixels of slack keeps sub-pixel
    // layout from flickering the fade on and off.
    const rtl = getComputedStyle(el).direction === "rtl";
    const left = (rtl ? max + el.scrollLeft : el.scrollLeft) > 4;
    const right = (rtl ? -el.scrollLeft : max - el.scrollLeft) > 4;
    el.toggleAttribute("data-rail-l", left);
    el.toggleAttribute("data-rail-r", right);
    setEdges((current) =>
      current.left === left && current.right === right
        ? current
        : { left, right },
    );
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // The row's own size AND its content's: a logo that finishes loading, or a
    // font that swaps, changes the overflow without resizing the box.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, ref]);

  return { edges, measure };
}

export function ScrollRail({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const ref = useRef<HTMLDivElement>(null);
  const { measure } = useRailEdges(ref);

  return (
    <div
      ref={ref}
      data-rail
      onScroll={measure}
      className={cn("overflow-x-auto", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
