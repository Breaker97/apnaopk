"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Breathing room between the pinned column and the viewport edge. */
const DEFAULT_GAP = 24;

interface StickySidebarProps {
  children: ReactNode;
  className?: string;
  /** Distance kept from the viewport edge while pinned, in pixels. */
  gap?: number;
}

/**
 * A sidebar that scrolls with the page until its own end, then stays put.
 *
 * `position: sticky` alone can only pin a column by its top, which is right for
 * a short one and wrong for a tall one: the moment the page scrolls, the top
 * group is frozen under the header and everything past the fold — the last
 * facets, the sort list — becomes unreachable without scrolling back up. Giving
 * it its own `overflow-y` instead trades that for a second scrollbar the
 * shopper has to find, on a platform whose overlay scrollbars are invisible
 * until touched.
 *
 * So the offset is measured rather than fixed. A column that fits on screen
 * rests below the header for the whole scroll. A column taller than the screen
 * gets a `top` far enough negative that it travels up with the page until its
 * *bottom* reaches the viewport, and pins from there — the shopper reads
 * through the whole panel on the way down and keeps the end of it in view
 * afterwards.
 *
 * The measurement re-runs on resize and whenever the panel's own height changes
 * — collapsing a filter group is exactly that.
 */
export function StickySidebar({
  children,
  className,
  gap = DEFAULT_GAP,
}: StickySidebarProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const root = document.documentElement;
    // Present whether or not the header is sticky; the height it publishes is 0
    // when it is not, which is exactly the offset a non-sticky header needs.
    const header = document.querySelector<HTMLElement>("[data-sticky-header]");

    let frame = 0;

    const measure = () => {
      frame = 0;

      const headerHeight =
        parseFloat(
          getComputedStyle(root).getPropertyValue("--storefront-header-height"),
        ) || 0;
      const viewport = window.innerHeight;
      const height = element.offsetHeight;
      const restingTop = headerHeight + gap;

      element.style.top =
        height + restingTop + gap <= viewport
          ? `${restingTop}px`
          : `${viewport - height - gap}px`;
    };

    // Group collapse animates its height over ~300ms, which fires the observer
    // on every frame of the transition. Coalescing keeps that to one write per
    // frame, and keeps the offset correct *during* the animation rather than
    // snapping once it lands.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();

    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (header) observer.observe(header);
    window.addEventListener("resize", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [gap]);

  return (
    <aside
      ref={ref}
      // `self-start` is required of a grid item: it stretches to the row height
      // by default, which leaves `top` with nothing to stick against. The
      // inline offset is what the first paint uses, before the measurement
      // below replaces it — a short panel is the common case and this is where
      // it ends up anyway.
      className={cn("lg:sticky lg:self-start", className)}
      style={{ top: `calc(var(--storefront-header-height, 0px) + ${gap}px)` }}
    >
      {children}
    </aside>
  );
}
