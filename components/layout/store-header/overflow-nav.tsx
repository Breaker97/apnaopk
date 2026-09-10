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

    const update = () => {
      const bounds = nav.getBoundingClientRect();
      for (const child of Array.from(nav.children)) {
        if (!(child instanceof HTMLElement)) continue;
        const rect = child.getBoundingClientRect();
        // A 1px tolerance so sub-pixel rounding never hides a fitting item.
        // Checked on both edges so RTL rows behave the same way.
        const overflows =
          rect.right > bounds.right + 1 || rect.left < bounds.left - 1;
        child.style.visibility = overflows ? "hidden" : "";
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    for (const child of Array.from(nav.children)) {
      if (child instanceof HTMLElement) observer.observe(child);
    }
    return () => observer.disconnect();
  }, [children]);

  return (
    <nav ref={ref} className={cn("overflow-hidden", className)} style={style}>
      {children}
    </nav>
  );
}
