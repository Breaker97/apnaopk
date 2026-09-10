import "server-only";

import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { Slider } from "@/models";
import {
  clampAutoplaySeconds,
  normalizeSlides,
  type SliderDocument,
  type SliderTransition,
} from "@/lib/sliders/types";

interface ResolvedSlider {
  handle: string;
  transition: SliderTransition;
  autoplaySeconds: number;
  slides: SliderDocument["slides"];
}

/**
 * Resolve a slider a section references by handle. Normalize-on-read keeps
 * the render contract intact whatever an older document stored; an inactive
 * or missing slider resolves to null and the section falls back to whatever
 * it renders without one.
 */
export const getStorefrontSlider = unstable_cache(
  async (handle: string): Promise<ResolvedSlider | null> => {
    if (!handle) return null;
    await connectDB();
    const doc = await Slider.findOne({ handle, isActive: true }).lean();
    if (!doc) return null;
    return {
      handle: doc.handle,
      transition: doc.transition === "fade" ? "fade" : "slide",
      autoplaySeconds: clampAutoplaySeconds(doc.autoplaySeconds),
      slides: normalizeSlides(doc.slides),
    };
  },
  ["storefront-slider"],
  { tags: [CACHE_TAGS.sliders], revalidate: 300 },
);
