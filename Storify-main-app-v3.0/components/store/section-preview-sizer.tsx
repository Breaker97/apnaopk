"use client";

import { useEffect } from "react";

export const PREVIEW_HEIGHT_MESSAGE = "storify:section-height";

/**
 * The storefront half of the builder's PER-SECTION preview: a draft render
 * of one section, framed inside that section's editor row. It reports the
 * section's own height to the builder as the section streams in, so the
 * frame can size itself to the content instead of showing a scrollbar or a
 * void — and can tell an empty section (nothing rendered) from a short one.
 *
 * The wrapper is measured, not the document: the store layout stretches to
 * the viewport, which inside a frame is whatever height the frame already
 * has — a measurement that would only ever confirm itself.
 *
 * Same-origin only — the builder checks the origin before it listens.
 */
export function SectionPreviewSizer() {
  useEffect(() => {
    if (window.self === window.top) return;
    const wrapper = document.querySelector<HTMLElement>(
      "[data-section-preview]",
    );
    if (!wrapper) return;
    const post = () => {
      window.parent.postMessage(
        {
          type: PREVIEW_HEIGHT_MESSAGE,
          height: Math.ceil(wrapper.getBoundingClientRect().height),
        },
        window.location.origin,
      );
    };
    post();
    const observer = new ResizeObserver(post);
    observer.observe(wrapper);
    // Images and fonts land after layout; a late one changes the height.
    window.addEventListener("load", post);
    return () => {
      observer.disconnect();
      window.removeEventListener("load", post);
    };
  }, []);

  return (
    <style>{`
      [data-store-chrome], [data-draft-pill] { display: none !important; }
      html, body { background: transparent; min-height: 0; }
    `}</style>
  );
}
