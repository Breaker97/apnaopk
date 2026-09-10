"use client";

/**
 * The header mega menu's AI Studio wiring — one config per promo frame, since
 * the side banner is a tall portrait and the bottom cards are wide letterbox
 * strips (see lib/ai-authoring/mega-menu-promo/types.ts). Each generates at the
 * closest model size and center-crops every result down to its exact frame
 * before it is applied — the same lock-and-crop contract the home-page promo
 * cards use, so the committed image already fits the slot.
 */

import { makeRatioCropPostProcess } from "@/components/ai-authoring/ratio-crop";
import type { AiStudioSurface } from "@/components/ai-authoring/studio-surface";
import type {
  AIAuthoringMediaOptions,
  AIAuthoringMediaResponse,
} from "@/lib/ai-authoring/types";
import {
  MEGA_MENU_BOTTOM_PROMO_HEIGHT,
  MEGA_MENU_BOTTOM_PROMO_WIDTH,
  MEGA_MENU_PROMO_HEIGHT,
  MEGA_MENU_PROMO_PROMPT_HINT,
  MEGA_MENU_PROMO_WIDTH,
} from "@/lib/ai-authoring/mega-menu-promo/types";

type MegaMenuPromoStudio = {
  surface: AiStudioSurface;
  generateDefaults: AIAuthoringMediaOptions;
  promptPlaceholder: string;
  postProcessResult: (
    response: AIAuthoringMediaResponse,
  ) => Promise<AIAuthoringMediaResponse>;
};

export const MEGA_MENU_PROMO_STUDIO: MegaMenuPromoStudio = {
  surface: "mega_menu_promo",
  // Portrait 2:3, the closest the model emits to the 10:13 promo panel.
  generateDefaults: {
    size: "1024x1536",
    outputFormat: "png",
    background: "opaque",
  },
  promptPlaceholder: MEGA_MENU_PROMO_PROMPT_HINT,
  postProcessResult: makeRatioCropPostProcess({
    width: MEGA_MENU_PROMO_WIDTH,
    height: MEGA_MENU_PROMO_HEIGHT,
    filename: "mega-menu-promo.png",
    ratioLabel: "the promo panel frame",
  }),
};

export const MEGA_MENU_BOTTOM_PROMO_STUDIO: MegaMenuPromoStudio = {
  surface: "mega_menu_promo",
  // Landscape 3:2, the closest the model emits to the wide bottom card.
  generateDefaults: {
    size: "1536x1024",
    outputFormat: "png",
    background: "opaque",
  },
  promptPlaceholder:
    "Describe a wide banner image for this promo card. The frame is a short letterbox strip, so keep the subject centred and leave the edges quiet.",
  postProcessResult: makeRatioCropPostProcess({
    width: MEGA_MENU_BOTTOM_PROMO_WIDTH,
    height: MEGA_MENU_BOTTOM_PROMO_HEIGHT,
    filename: "mega-menu-bottom-promo.png",
    ratioLabel: "the bottom card frame",
  }),
};
