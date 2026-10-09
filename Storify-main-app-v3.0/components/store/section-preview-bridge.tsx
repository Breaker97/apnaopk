"use client";

import { useEffect } from "react";
import { useClientValue } from "@/hooks/use-client-value";

export const PREVIEW_SELECT_MESSAGE = "storify:section-select";
export const PREVIEW_SCROLL_MESSAGE = "storify:scroll-to";

/**
 * The storefront half of the builder's embedded preview. Active ONLY when
 * this draft-mode render sits inside a same-origin iframe (the builder's
 * panel): it outlines sections on hover, intercepts clicks to select the
 * section in the builder instead of navigating, scrolls to a section when
 * the builder asks, and hides the exit pill (the builder owns the session).
 * A normal draft-preview tab — or any visitor — never runs any of this.
 */
export function SectionPreviewBridge() {
  const framed = useClientValue(() => window.self !== window.top, false);

  useEffect(() => {
    if (!framed) return;

    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest(
        "[data-section-id]",
      );
      if (!target) return;
      // Selecting, not shopping: keep the preview parked on this page.
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage(
        {
          type: PREVIEW_SELECT_MESSAGE,
          id: target.getAttribute("data-section-id"),
        },
        window.location.origin,
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; id?: string } | null;
      if (data?.type !== PREVIEW_SCROLL_MESSAGE || !data.id) return;
      document
        .querySelector(`[data-section-id="${CSS.escape(data.id)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("message", onMessage);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("message", onMessage);
    };
  }, [framed]);

  if (!framed) return null;

  return (
    <style>{`
      [data-draft-pill] { display: none; }
      [data-section-id] { cursor: pointer; }
      [data-section-id]:hover {
        outline: 2px dashed var(--primary, #2E5FE8);
        outline-offset: -2px;
      }
    `}</style>
  );
}
