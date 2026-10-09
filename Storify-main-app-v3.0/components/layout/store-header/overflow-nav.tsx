"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A single-row nav that never shows a half-clipped link: items that don't
 * fully fit inside the row are made invisible (visibility, not display, so
 * the layout stays stable and the measurement can't oscillate). Used by the
 * header's inline nav runs, where merchant-authored labels of any length
 * meet template-constrained space.
 */
export function OverflowNav({
  className,
  style,
  children,
}: {
  className?: string;
  /** Layout the header builder computes — gap, justification, paint. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const items = Array.from(nav.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );

    // Only ever run by the observer, which reports after layout — and on its
    // first pass reports every box it watches — so these reads come free.
    // Measured straight from the effect, the first read forced a layout of
    // the whole page in the middle of hydration, and a write between two
    // reads made the next read lay out again: every read comes first.
    const update = () => {
      const bounds = nav.getBoundingClientRect();
      const overflowing = items.map((item) => {
        const rect = item.getBoundingClientRect();
        // A 1px tolerance so sub-pixel rounding never hides a fitting item.
        // Checked on both edges so RTL rows behave the same way.
        return rect.right > bounds.right + 1 || rect.left < bounds.left - 1;
      });
      items.forEach((item, index) => {
        const visibility = overflowing[index] ? "hidden" : "";
        if (item.style.visibility !== visibility) {
          item.style.visibility = visibility;
        }
      });
    };

    const observer = new ResizeObserver(update);
    observer.observe(nav);
    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
  }, [children]);

  return (
    <nav ref={ref} className={cn("overflow-hidden", className)} style={style}>
      {children}
    </nav>
  );
}
