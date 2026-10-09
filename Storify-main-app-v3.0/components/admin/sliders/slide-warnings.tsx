"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Wand2 } from "lucide-react";
import {
  contrastRatio,
  backgroundAccentColor,
  resolveSlideBackground,
  resolveSlideLayout,
  resolveTextStyle,
  slideWarnings,
  suggestContrastFix,
  type SlideShape,
  type SliderSlide,
  type SlideWarning,
} from "@/lib/sliders/types";

/**
 * What the editor can tell a merchant before a slide ships: a button with
 * nowhere to go, a picture narrower than a hero, a heavy video, a missing
 * alt text, and copy that will not read against what is behind it — with a
 * one-click fix for that last one.
 *
 * Contrast against a flat colour is judged from the data (`slideWarnings`).
 * Against a PICTURE it is judged here, by sampling the pixels under the copy
 * — the region the band aligns the copy to — and comparing their mean with
 * the heading's ink. The picture is read through the app's own image
 * route, so a bucket that sends no CORS headers still lets the canvas read
 * it; where even that fails, no warning is better than a wrong one.
 */

export type SlideWarningLabels = Record<SlideWarning, string> & { fix: string };

/** The part of the frame the copy occupies, as shares, from the band's alignment. */
function copyRegion(slide: SliderSlide, shape: SlideShape) {
  const layout = resolveSlideLayout(slide, shape);
  const width = 0.5;
  const height = 0.5;
  const x = layout.h === "left" ? 0 : layout.h === "right" ? 1 - width : 0.5 - width / 2;
  const y = layout.v === "top" ? 0 : layout.v === "bottom" ? 1 - height : 0.5 - height / 2;
  return { x, y, width, height };
}

/** The picture's mean colour under the copy, or null where it cannot be read. */
async function sampleUnderCopy(
  src: string,
  overlay: number,
  slide: SliderSlide,
  shape: SlideShape,
  signal: { cancelled: boolean },
): Promise<string | null> {
  const candidates = [
    `/_next/image?url=${encodeURIComponent(src)}&w=640&q=60`,
    src,
  ];
  for (const url of candidates) {
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const node = new Image();
        node.crossOrigin = "anonymous";
        node.onload = () => resolve(node);
        node.onerror = () => reject(new Error("load"));
        node.src = url;
      });
      if (signal.cancelled) return null;
      const canvas = document.createElement("canvas");
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(image, 0, 0, size, size);
      const region = copyRegion(slide, shape);
      const data = context.getImageData(
        Math.floor(region.x * size),
        Math.floor(region.y * size),
        Math.max(1, Math.floor(region.width * size)),
        Math.max(1, Math.floor(region.height * size)),
      ).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const count = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
      const hex = (v: number) => Math.round(v / count).toString(16).padStart(2, "0");
      // The darkening the slide lays over the picture darkens the sample too.
      const dim = (v: number) => v * (1 - overlay / 100);
      return `#${hex(dim(r))}${hex(dim(g))}${hex(dim(b))}`;
    } catch {
      // A tainted canvas or a picture that would not load: try the next way in.
    }
  }
  return null;
}

export function SlideWarningsStrip({
  slide,
  shape,
  labels,
  onFix,
}: {
  slide: SliderSlide;
  shape: SlideShape;
  labels: SlideWarningLabels;
  /** Applies the contrast fix the strip worked out. */
  onFix?: (patch: Partial<SliderSlide>) => void;
}) {
  const [sample, setSample] = useState<string | null>(null);
  const background = resolveSlideBackground(slide, shape);
  const picture = background.type === "image" || background.type === "video" ? background.image : undefined;
  const overlay = background.overlay ?? 0;
  const ink = resolveTextStyle(slide, "heading", shape).color ?? "#ffffff";
  const headingOn = slide.elements.heading;
  const layout = resolveSlideLayout(slide, shape);
  const regionKey = `${layout.h}:${layout.v}`;

  // Sampling applies only over a picture, under a heading, with no plate;
  // otherwise the sample is simply not consulted.
  const applies = Boolean(picture && headingOn && !slide.plate);
  useEffect(() => {
    if (!applies || !picture) return;
    const signal = { cancelled: false };
    void sampleUnderCopy(picture, overlay, slide, shape, signal).then((mean) => {
      if (!signal.cancelled) setSample(mean);
    });
    return () => {
      signal.cancelled = true;
    };
    // The sample depends on the picture, its darkening and where the copy
    // sits — not on the slide object's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picture, overlay, applies, regionKey, shape]);

  const warnings = new Set<SlideWarning>(slideWarnings(slide, shape));
  const pictureContrast = applies && sample !== null && contrastRatio(ink, sample) < 3;
  if (pictureContrast) warnings.add("low-contrast");
  if (warnings.size === 0) return null;

  // What the copy sits on, for the fix: the sampled picture, or the flat colour.
  const behind = pictureContrast ? sample : backgroundAccentColor(background);
  const fix = warnings.has("low-contrast") && behind && onFix
    ? suggestContrastFix(slide, shape, behind)
    : null;

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="warnings">
      {[...warnings].map((warning) => (
        <li
          key={warning}
          className="flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {labels[warning]}
          {warning === "low-contrast" && fix ? (
            <button
              type="button"
              onClick={() => onFix?.(fix)}
              className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-900 px-2 py-0.5 text-[10px] font-semibold text-amber-50 transition hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950"
            >
              <Wand2 className="h-3 w-3" />
              {labels.fix}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
