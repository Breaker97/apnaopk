"use client";

/**
 * The blog featured image's AI Studio wiring: a from-scratch `generateDefaults`
 * that asks for the closest landscape the image model can emit (3:2), and a
 * `postProcessResult` that crops every result to a locked 16:9 frame and
 * re-uploads it. Together they make the studio's `blog_featured` surface produce
 * an image that already fits the storefront blog cards and home carousel — no
 * manual resizing, and no crop surprise when the post publishes.
 */

import { makeRatioCropPostProcess } from "@/components/ai-authoring/ratio-crop";
import type { AIAuthoringMediaOptions } from "@/lib/ai-authoring/types";
import {
  BLOG_FEATURED_HEIGHT,
  BLOG_FEATURED_WIDTH,
} from "@/lib/ai-authoring/blog-featured/types";

/** Generate landscape from scratch (3:2, the closest the model emits to 16:9). */
export const BLOG_FEATURED_GENERATE_DEFAULTS: AIAuthoringMediaOptions = {
  size: "1536x1024",
  outputFormat: "png",
  background: "opaque",
};

export const BLOG_FEATURED_PROMPT_PLACEHOLDER =
  "Describe a wide 16:9 featured image for this post. Keep the key subject centered.";

/**
 * Crop a fresh studio result to the locked 16:9 frame and re-upload it, so the
 * on-stage and saved image are already the blog ratio.
 */
export const cropBlogFeaturedResult = makeRatioCropPostProcess({
  width: BLOG_FEATURED_WIDTH,
  height: BLOG_FEATURED_HEIGHT,
  filename: "blog-featured-16x9.png",
  ratioLabel: "16:9",
});
