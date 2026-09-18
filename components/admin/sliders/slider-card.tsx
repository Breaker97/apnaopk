"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { Copy, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { SavedSlider } from "@/components/store/saved-slider";
import { apiClient } from "@/lib/api/client";
import {
  buildRenderSlides,
  collectSlideProductIds,
  type SlideProductInfo,
} from "@/lib/sliders/render";
import {
  clampAutoplaySeconds,
  SLIDE_SHAPE_ASPECT_CLASS,
  sliderWorkingContent,
  type SliderDocument,
} from "@/lib/sliders/types";
import type { StoreSurface } from "@/lib/storefront/themes/surface";
import type { SliderStats } from "@/app/api/admin/sliders/[id]/stats/route";
import { SliderEditor } from "./slider-editor";

/**
 * One slider on the Sliders page. Collapsed, it renders the REAL storefront
 * component with the PUBLISHED content — same component, same props shape,
 * same resolved slides — so what the admin previews cannot drift from what
 * ships. Selecting it swaps in the editor, which works on the draft.
 */
export function SliderCard({
  slider,
  expanded,
  onExpand,
  onChange,
  onSave,
  onPublish,
  onDiscard,
  onRestore,
  onDelete,
  onDuplicate,
  saving,
  publishing,
  dirty,
  stats,
  locale,
  tSafe,
  storeSurface,
  languages,
  defaultLanguage,
}: {
  slider: SliderDocument;
  expanded: boolean;
  onExpand: () => void;
  onChange: (next: SliderDocument) => void;
  onSave: () => void;
  onPublish: () => void;
  onDiscard: () => void;
  onRestore: (index: number) => Promise<void>;
  onDelete: () => void;
  onDuplicate: () => void;
  saving: boolean;
  publishing: boolean;
  /** Edited since the last save. */
  dirty: boolean;
  stats?: SliderStats;
  locale: string;
  tSafe: TSafe;
  storeSurface?: StoreSurface;
  languages: string[];
  defaultLanguage: string;
}) {
  // What the editor works on: the draft when there is one, else what is live.
  const working = useMemo(
    () => ({ ...slider, ...sliderWorkingContent(slider) }),
    [slider],
  );
  const hasDraft = Boolean(slider.draft);

  return (
    <div
      id={slider._id ? `slider-${slider._id}` : undefined}
      className="scroll-mt-4 rounded-2xl border border-border bg-card shadow-sm"
    >
      {expanded ? (
        <SliderEditor
          slider={working}
          onChange={onChange}
          onSave={onSave}
          onPublish={onPublish}
          onDiscard={hasDraft ? onDiscard : undefined}
          onRestore={onRestore}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          saving={saving}
          publishing={publishing}
          dirty={dirty}
          hasDraft={hasDraft}
          stats={stats}
          locale={locale}
          tSafe={tSafe}
          storeSurface={storeSurface}
          languages={languages}
          defaultLanguage={defaultLanguage}
        />
      ) : (
        <div className="p-4 sm:p-5">
          {/* Collapsed: the name opens the editor, and the copy is offered
              here too — duplicating a slider is a thing you do to one you are
              looking at, not one you have opened. */}
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={onExpand}
                className="block min-w-0 truncate text-left text-sm font-semibold text-foreground hover:underline"
              >
                {slider.name || tSafe("admin.sliders.untitled", "Untitled slider")}
              </button>
              {hasDraft ? (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                  {tSafe("admin.sliders.draftBadge", "Draft")}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* The published slide as a still picture, for an email or a
                  social card — the link a mail template embeds. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full px-3 text-xs"
                title={tSafe("admin.sliders.imageLinkHint", "A picture of the first published slide, for emails and social cards. Add ?slide=<id> for another slide.")}
                onClick={() => {
                  const url = `${window.location.origin}/api/sliders/${slider.handle}/image`;
                  void navigator.clipboard?.writeText(url).then(
                    () => toast.success(tSafe("admin.sliders.imageLinkCopied", "Image link copied")),
                    () => toast.error(url),
                  );
                }}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                {tSafe("admin.sliders.imageLink", "Image link")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full px-3 text-xs"
                onClick={onDuplicate}
              >
                <Copy className="h-3.5 w-3.5" />
                {tSafe("admin.sliders.duplicate", "Duplicate")}
              </Button>
            </div>
          </div>
          {/* The preview is the live component, so it is click-through: the
              card opens the editor, the slider itself keeps its own dots and
              links inert. */}
          <div
            role="button"
            tabIndex={0}
            onClick={onExpand}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onExpand();
              }
            }}
            className="cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="pointer-events-none">
              <SliderPreview slider={slider} storeSurface={storeSurface} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY: Map<string, SlideProductInfo> = new Map();

/**
 * The storefront slider, fed the same way the storefront feeds it, with the
 * slider's PUBLISHED content. Exported for every admin surface that
 * previews a saved slider (the Hero Slider studio's cells and its pick
 * dialog) so previews can never drift from what ships.
 */
export function SliderPreview({
  slider,
  className,
  storeSurface,
}: {
  slider: SliderDocument;
  className?: string;
  /** The active theme, compiled: the preview then wears the storefront's fonts and button styling. */
  storeSurface?: StoreSurface;
}) {
  const [products, setProducts] = useState<Map<string, SlideProductInfo>>(
    new Map(),
  );

  const productIds = useMemo(
    () => collectSlideProductIds(slider.slides),
    [slider.slides],
  );
  // Stable dependency: the ids themselves, not the array identity.
  const productKey = productIds.join(",");

  // Resolve bound products so the Price element behaves here exactly as it
  // does on the storefront — present only when a product actually resolved.
  useEffect(() => {
    const ids = productKey ? productKey.split(",") : [];
    // Nothing bound: the render below already ignores the stale map, so
    // there is no state to clear here.
    if (ids.length === 0) return;
    let cancelled = false;
    Promise.all(
      ids.map((id) =>
        apiClient
          .get<{ _id: string; slug?: string; price?: number }>(
            `/api/admin/products/${id}`,
          )
          .catch(() => null),
      ),
    ).then((rows) => {
      if (cancelled) return;
      const next = new Map<string, SlideProductInfo>();
      for (const row of rows) {
        if (!row?._id || !row.slug || typeof row.price !== "number") continue;
        next.set(String(row._id), { slug: row.slug, priceMin: row.price });
      }
      setProducts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [productKey]);

  const slider_ = (
    <SavedSlider
      slides={buildRenderSlides(slider.slides, productKey ? products : EMPTY)}
      transition={slider.transition}
      autoplayDelayMs={clampAutoplaySeconds(slider.autoplaySeconds) * 1000}
      controls={slider.controls}
      // The card frames a slider at the landscape band — the desktop hero's
      // own proportions. A host with a shape of its own (a studio grid
      // cell) overrides it, and the container query inside then picks the
      // band that shape falls in.
      className={className ?? SLIDE_SHAPE_ASPECT_CLASS.landscape}
    />
  );
  if (!storeSurface) return slider_;
  return (
    <div
      className="store-surface bg-transparent"
      {...storeSurface.attributes}
      style={storeSurface.vars as CSSProperties}
    >
      {slider_}
    </div>
  );
}
