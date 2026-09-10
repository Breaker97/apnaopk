"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { PREVIEW_HEIGHT_MESSAGE } from "@/components/store/section-preview-sizer";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { cn } from "@/lib/utils";

/** Where the frame starts and how tall it may grow before it scrolls. */
const MIN_HEIGHT = 120;
// Tall enough for a two-row product grid with its chips and filter row —
// below that the frame cut a card in half, which reads as a broken render
// rather than a cropped one.
const MAX_HEIGHT = 900;
/** Under this the section painted nothing — a gap section, a rail with no
 * campaigns, a feature that is switched off. */
const EMPTY_HEIGHT = 24;

/**
 * The real storefront render of ONE section, framed inside its editor row.
 *
 * It is the draft route with `?section=<id>`, so what shows is what the
 * storefront will paint — the same components, the same live products and
 * categories — not an admin-side imitation. The frame reloads on every
 * landed autosave (`nonce`), which is what makes a field edit visible here
 * a moment after it is typed, and sizes itself to the message the framed
 * page posts, so a short rail and a tall grid each take the room they need.
 */
export function SectionPreviewFrame({
  locale,
  handle,
  sectionId,
  blockId,
  nonce,
  title,
  hint,
  emptyLabel,
  className,
}: {
  locale: string;
  handle: string;
  sectionId: string;
  /** Narrows the render to one of the section's blocks — a per-row preview. */
  blockId?: string;
  /** Bumped by the builder after each save; changes reload the frame. */
  nonce: number;
  title: string;
  hint?: string;
  /** Shown in place of the frame when the section rendered nothing. */
  emptyLabel: string;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      // Several frames can be open at once — only this frame's page counts.
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; height?: number } | null;
      if (data?.type !== PREVIEW_HEIGHT_MESSAGE) return;
      if (typeof data.height !== "number" || !Number.isFinite(data.height)) {
        return;
      }
      if (data.height < EMPTY_HEIGHT) {
        setState("empty");
        return;
      }
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, data.height)));
      setState("ready");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // A reload starts the wait over.
  useApplyOnChange([nonce], () => setState("loading"));

  const src =
    `/api/admin/store-pages/preview?locale=${encodeURIComponent(locale)}&handle=${encodeURIComponent(handle)}&section=${encodeURIComponent(sectionId)}` +
    (blockId ? `&block=${encodeURIComponent(blockId)}` : "") +
    `&r=${nonce}`;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        {hint ? (
          <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <div
        className={cn(
          "store-surface relative overflow-hidden rounded-[8px] border bg-background",
          state === "loading" && "animate-pulse",
          state === "empty" && "border-dashed bg-muted/30",
        )}
        style={{ height: state === "empty" ? undefined : height }}
      >
        {state === "loading" ? (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : null}
        {state === "empty" ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </p>
        ) : null}
        <iframe
          ref={frame}
          key={nonce}
          src={src}
          title={title}
          className={cn(
            "w-full border-0 bg-transparent",
            state === "ready" ? "h-full" : "h-px opacity-0",
          )}
          // Clicks land on real storefront links; a preview that navigates
          // its own frame away from the section is a trap, so pointer input
          // is off — it scrolls, it does not click.
          style={{ pointerEvents: "none" }}
          tabIndex={-1}
          aria-hidden
        />
      </div>
    </div>
  );
}
