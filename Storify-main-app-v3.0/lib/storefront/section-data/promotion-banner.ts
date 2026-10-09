import "server-only";

import { buildRenderSlides, type RenderSliderSlide } from "@/lib/sliders/render";
import type { SliderSlide } from "@/lib/sliders/types";
import type { SectionReadMode } from "./read-mode";
import { resolveSlideProducts, type CellDataScope } from "./slider-cells";

/** Whether a slide would put anything visible on screen. */
function slideShowsSomething(slide: RenderSliderSlide): boolean {
  const { elements, texts } = slide;
  return Boolean(
    (elements.heading && texts.heading) ||
      (elements.description && texts.description) ||
      (elements.tagline && texts.tagline) ||
      (elements.cta && texts.cta) ||
      slide.price ||
      (elements.countdown && slide.countdownEndsAt) ||
      slide.background.type !== "solid" ||
      slide.productImage,
  );
}

/**
 * The Promotional Banner's slide, as it renders now: its copy in the
 * shopper's language, its bound product's price, and nothing at all when the
 * slide is out of its schedule or would draw an empty frame.
 *
 * One slide: the banner is a single placement, not a carousel. Extras a
 * merchant saved before that rule stay in storage, unrendered.
 */
export async function loadPromotionBannerSlides(
  stored: SliderSlide[],
  locale: string,
  mode: SectionReadMode = "page",
  scope: CellDataScope = {},
): Promise<RenderSliderSlide[]> {
  const slides = stored.slice(0, 1);
  const products = await resolveSlideProducts(slides, mode, scope);
  return buildRenderSlides(slides, products, { locale }).filter(slideShowsSomething);
}
