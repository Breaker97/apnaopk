import type { AIAuthoringMediaResponse } from "@/lib/ai-authoring/types";

export const HERO_BANNER_WIDTH = 1360 as const;
export const HERO_BANNER_HEIGHT = 314 as const;
export const HERO_BANNER_TARGET_FIELD = "home.hero.slide.image" as const;

export type HeroBannerPlacement = "left" | "center" | "right";

export type HeroBannerRequest = {
  operation: "generate" | "edit";
  locale: string;
  prompt: string;
  sourceUrl?: string;
};

export type HeroBannerBrief = {
  visualDescription: string;
  headline?: string;
  subheadline?: string;
  price?: string;
  cta?: string;
  subjectPlacement: HeroBannerPlacement;
  textPlacement: HeroBannerPlacement;
  style?: string;
  background?: string;
  alt: string;
};

export type HeroBannerResponse = {
  targetField: typeof HERO_BANNER_TARGET_FIELD;
  media: AIAuthoringMediaResponse["media"];
  banner: {
    width: typeof HERO_BANNER_WIDTH;
    height: typeof HERO_BANNER_HEIGHT;
    alt: string;
    textApplied: boolean;
  };
  warning?: string;
};
