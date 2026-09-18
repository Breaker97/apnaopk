import "server-only";

import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { Slider } from "@/models";
import {
  normalizeSliderDocument,
  type SliderControls,
  type SliderDocument,
  type SliderTransition,
} from "@/lib/sliders/types";

export interface ResolvedSlider {
  handle: string;
  transition: SliderTransition;
  autoplaySeconds: number;
  controls: SliderControls;
  slides: SliderDocument["slides"];
}

/**
 * Resolve a slider a section references by handle — its PUBLISHED content,
 * never a draft. Normalize-on-read keeps the render contract intact whatever
 * an older document stored (a version-1 document's numbers are migrated on
 * the way); an inactive or missing slider resolves to null and the section
 * falls back to whatever it renders without one.
 */
export const getStorefrontSlider = unstable_cache(
  async (handle: string): Promise<ResolvedSlider | null> => {
    if (!handle) return null;
    await connectDB();
    const raw = await Slider.findOne({ handle, isActive: true }).lean();
    if (!raw) return null;
    const doc = normalizeSliderDocument(raw);
    return {
      handle: doc.handle,
      transition: doc.transition,
      autoplaySeconds: doc.autoplaySeconds,
      controls: doc.controls,
      slides: doc.slides,
    };
  },
  ["storefront-slider"],
  { tags: [CACHE_TAGS.sliders], revalidate: 300 },
);
