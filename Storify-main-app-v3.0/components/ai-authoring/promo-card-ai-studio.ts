"use client";

/**
 * The Promotions & Offers cards' AI Studio wiring. The home page bento grid has
 * three distinct frames — tall portrait, near-square, and wide banner — so each
 * of its five card slots maps to a ratio-locked surface, the model size closest
 * to that frame, and a post-process that center-crops every result to the
 * slot's exact ratio and re-uploads it. The committed image already fits its
 * card, whichever slot the merchant is filling.
 */

import { makeRatioCropPostProcess } from "@/components/ai-authoring/ratio-crop";
import type { AiStudioSurface } from "@/components/ai-authoring/studio-surface";
import type {
  AIAuthoringMediaOptions,
  AIAuthoringMediaResponse,
} from "@/lib/ai-authoring/types";
import {
  PROMO_SQUARE_HEIGHT,
  PROMO_SQUARE_WIDTH,
  PROMO_TALL_HEIGHT,
  PROMO_TALL_WIDTH,
  PROMO_WIDE_HEIGHT,
  PROMO_WIDE_WIDTH,
} from "@/lib/ai-authoring/promo-card/types";

type PromoCardSlotStudio = {
  surface: AiStudioSurface;
  generateDefaults: AIAuthoringMediaOptions;
  promptPlaceholder: string;
  postProcessResult: (
    response: AIAuthoringMediaResponse,
  ) => Promise<AIAuthoringMediaResponse>;
};

const TALL_SLOT: PromoCardSlotStudio = {
  surface: "promo_tall",
  // Portrait 2:3, the closest the model emits to the 317:565 card.
  generateDefaults: {
    size: "1024x1536",
    outputFormat: "png",
    background: "opaque",
  },
  promptPlaceholder:
    "Describe a tall portrait promo image for this card. Keep the key subject centered.",
  postProcessResult: makeRatioCropPostProcess({
    width: PROMO_TALL_WIDTH,
    height: PROMO_TALL_HEIGHT,
    filename: "promo-tall.png",
    ratioLabel: "the tall card frame",
  }),
};

const SQUARE_SLOT: PromoCardSlotStudio = {
  surface: "promo_square",
  // Square 1:1, trimmed slightly to the 317:272 near-square card.
  generateDefaults: {
    size: "1024x1024",
    outputFormat: "png",
    background: "opaque",
  },
  promptPlaceholder:
    "Describe a near-square promo image for this card. Keep the key subject centered.",
  postProcessResult: makeRatioCropPostProcess({
    width: PROMO_SQUARE_WIDTH,
    height: PROMO_SQUARE_HEIGHT,
    filename: "promo-square.png",
    ratioLabel: "the square card frame",
  }),
};

const WIDE_SLOT: PromoCardSlotStudio = {
  surface: "promo_wide",
  // Landscape 3:2, cropped down to the 654:272 wide banner.
  generateDefaults: {
    size: "1536x1024",
    outputFormat: "png",
    background: "opaque",
  },
  promptPlaceholder:
    "Describe a wide banner promo image for this card. Keep the key subject centered.",
  postProcessResult: makeRatioCropPostProcess({
    width: PROMO_WIDE_WIDTH,
    height: PROMO_WIDE_HEIGHT,
    filename: "promo-wide.png",
    ratioLabel: "the wide banner frame",
  }),
};

/**
 * Studio config per card index, matching the bento grid's five slots: tall
 * left, tall middle, two near-squares top-right, and the wide bottom banner.
 */
export const PROMO_CARD_SLOT_STUDIOS: readonly PromoCardSlotStudio[] = [
  TALL_SLOT,
  TALL_SLOT,
  SQUARE_SLOT,
  SQUARE_SLOT,
  WIDE_SLOT,
];
