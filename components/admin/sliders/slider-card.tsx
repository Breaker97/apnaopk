"use client";

import { useEffect, useMemo, useState } from "react";
import type { TSafe } from "@/components/admin/online-store/t-safe";
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
  type SliderDocument,
} from "@/lib/sliders/types";
import { SliderEditor } from "./slider-editor";

/**
 * One slider on the Sliders page. Collapsed, it renders the REAL storefront
 * component — same component, same props shape, same resolved slides — so
 * what the admin previews cannot drift from what ships. Selecting it swaps in
 * the editor.
 */
export function SliderCard({
  slider,
  expanded,
  onExpand,
  onChange,
  onSave,
  onDelete,
  saving,
  locale,
  tSafe,
}: {
  slider: SliderDocument;
  expanded: boolean;
  onExpand: () => void;
  onChange: (next: SliderDocument) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  locale: string;
  tSafe: TSafe;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      {expanded ? (
        <SliderEditor
          slider={slider}
          onChange={onChange}
          onSave={onSave}
          onDelete={onDelete}
          saving={saving}
          locale={locale}
          tSafe={tSafe}
        />
      ) : (
        <div className="p-4 sm:p-5">
          <button
            type="button"
            onClick={onExpand}
            className="mb-2 block text-left text-sm font-semibold text-foreground hover:underline"
          >
            {slider.name || tSafe("admin.sliders.untitled", "Untitled slider")}
          </button>
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
              <SliderPreview slider={slider} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY: Map<string, SlideProductInfo> = new Map();

/**
 * The storefront slider, fed the same way the storefront feeds it. Exported
 * for every admin surface that previews a saved slider (the Hero Slider
 * studio's cells and its pick dialog) so previews can never drift from what
 * ships.
 */
export function SliderPreview({
  slider,
  className,
}: {
  slider: SliderDocument;
  className?: string;
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

  return (
    <SavedSlider
      slides={buildRenderSlides(slider.slides, productKey ? products : EMPTY)}
      transition={slider.transition}
      autoplayDelayMs={clampAutoplaySeconds(slider.autoplaySeconds) * 1000}
      // The card frames a slider at the landscape band — the shape a hero
      // cell takes by default. A host with a shape of its own (a studio grid
      // cell) overrides it, and the container query inside then picks the
      // band that shape falls in.
      className={className ?? SLIDE_SHAPE_ASPECT_CLASS.landscape}
    />
  );
}
