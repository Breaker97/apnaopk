"use client";

import { useEffect } from "react";

/**
 * Publishes the header chrome's rendered height as `--store-chrome-h` on
 * the store surface, so a "full height" hero can fill exactly the first
 * viewport under it. The header is whatever the Header Studio built —
 * announcement bar, one or three rows, a category strip — so its height is
 * only knowable at runtime; a fixed 5rem guess left a tall header pushing
 * the hero past the fold.
 *
 * Both chrome wrappers are `display: contents`, so the boxes to measure are
 * the first real descendants under the wrapper; ResizeObserver keeps the
 * value honest through breakpoints and content changes.
 */
export function StoreChromeHeight() {
  useEffect(() => {
    const wrapper = document.querySelector<HTMLElement>(
      '[data-store-chrome="header"]',
    );
    const surface = wrapper?.closest<HTMLElement>("[data-store-theme]");
    if (!wrapper || !surface) return;

    // Walk past display:contents layers to the elements that own a box.
    const boxes: HTMLElement[] = [];
    const collect = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (getComputedStyle(child).display === "contents") collect(child);
        else boxes.push(child);
      }
    };
    collect(wrapper);
    if (boxes.length === 0) return;

    const publish = () => {
      const height = boxes.reduce(
        // A bar set to overlap the hero is pulled out of the flow, so it
        // costs the page no height — counting it would leave a full-height
        // hero short by exactly the header.
        (sum, box) =>
          box.hasAttribute("data-header-overlap")
            ? sum
            : sum + box.getBoundingClientRect().height,
        0,
      );
      surface.style.setProperty("--store-chrome-h", `${Math.round(height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    for (const box of boxes) observer.observe(box);
    return () => {
      observer.disconnect();
      surface.style.removeProperty("--store-chrome-h");
    };
  }, []);

  return null;
}
