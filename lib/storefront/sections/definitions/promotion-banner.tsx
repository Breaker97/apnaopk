import { PromotionBanner } from "@/components/store/sections/promotion-banner";
import { SavedSliderLazy as SavedSlider } from "@/components/store/saved-slider-lazy";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import {
  buildRenderSlides,
  collectSlideProductIds,
  type RenderSliderSlide,
  type SlideProductInfo,
} from "@/lib/sliders/render";
import {
  clampAutoplaySeconds,
  DEFAULT_AUTOPLAY_SECONDS,
  MAX_AUTOPLAY_SECONDS,
  MIN_AUTOPLAY_SECONDS,
  SLIDER_TRANSITIONS,
  type SliderSlide,
  type SliderTransition,
} from "@/lib/sliders/types";
import {
  getProductCompareAtRange,
  getProductPriceRange,
} from "@/lib/products/price-display";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import { cn } from "@/lib/utils";
import { lt } from "../localized";
import type {
  LocalizedText,
  SectionDefinition,
  SectionRenderProps,
} from "../types";

/**
 * The Promotional Banner: an INLINE slider owned by this section instance.
 *
 * The slides live in `settings.slides` — full slider editing power (the
 * Sliders page's editor embeds in the builder) without a document in the
 * saved-slider library, so a banner designed for one page never appears in
 * every section's slider picker. Instances written before the slides model
 * carry only the legacy single-image fields; they keep rendering through the
 * legacy path until the studio seeds their content into a first slide.
 */

/** Resolve every bound product once — the same lookup section-grid runs. */
async function resolveSlideProducts(
  slides: SliderSlide[],
): Promise<Map<string, SlideProductInfo>> {
  const products = new Map<string, SlideProductInfo>();
  const ids = collectSlideProductIds(slides);
  if (ids.length === 0) return products;
  try {
    const cards = await getStorefrontProductCards({ ids, limit: ids.length });
    for (const card of cards) {
      if (!card.slug) continue;
      const priceMin = getProductPriceRange(card).min;
      const compareAtMax = getProductCompareAtRange(card)?.max;
      products.set(String(card._id), {
        slug: card.slug,
        priceMin,
        ...(compareAtMax !== undefined ? { compareAtMax } : {}),
      });
    }
  } catch {
    // Price is decoration on a promo slide; a failed lookup must not take
    // the section — or the page — down with it.
  }
  return products;
}

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

async function RenderSlides({ settings, ctx }: SectionRenderProps) {
  // One slide: the banner is a single placement, not a carousel. Extras a
  // merchant saved before that rule stay in storage, unrendered.
  const slides = (settings.slides as SliderSlide[]).slice(0, 1);
  const products = await resolveSlideProducts(slides);
  const renderSlides = buildRenderSlides(slides, products).filter(
    slideShowsSomething,
  );
  if (renderSlides.length === 0) {
    return sectionEmptyState(ctx, {
      title: "Promotional banner",
      hint: "Design this banner's slides in the builder — background, copy, product art, and CTA.",
    });
  }
  const fullWidth = settings.fullWidth as boolean;
  const banner = (
    <SavedSlider
      slides={renderSlides}
      transition={settings.transition as SliderTransition}
      autoplayDelayMs={clampAutoplaySeconds(settings.autoplaySeconds) * 1000}
      // The legacy banner's own frame, so switching a banner to slides never
      // changes the space it occupies on the page.
      className={cn(
        "aspect-[16/7] sm:aspect-[16/5]",
        fullWidth ? "rounded-none" : "rounded-xl",
      )}
    />
  );
  return (
    <section className="py-5 lg:py-8">
      {fullWidth ? banner : <div className="container mx-auto px-4">{banner}</div>}
    </section>
  );
}

export const promotionBanner: SectionDefinition = {
  type: "promotion-banner",
  version: 1,
  category: "promotions",
  suggested: true,
  fields: [
    // The inline slider model. `slides` is edited by the bespoke studio in
    // the builder; the write gate normalizes it through the slider contract.
    { key: "slides", type: "slides" },
    { key: "transition", type: "select", options: SLIDER_TRANSITIONS, default: "slide" },
    {
      key: "autoplaySeconds",
      type: "number",
      default: DEFAULT_AUTOPLAY_SECONDS,
      min: MIN_AUTOPLAY_SECONDS,
      max: MAX_AUTOPLAY_SECONDS,
    },
    { key: "fullWidth", type: "toggle", default: false },
    // Legacy single-banner fields — kept so instances written before the
    // slides model still render (and so the studio can seed their content
    // into the first slide).
    { key: "image", type: "image" },
    { key: "heading", type: "text", translatable: true, default: "" },
    { key: "subheading", type: "text", translatable: true, default: "" },
    { key: "ctaLabel", type: "text", translatable: true, default: "" },
    { key: "link", type: "url", default: "" },
  ],
  Render(props) {
    const { settings, ctx } = props;
    if ((settings.slides as SliderSlide[]).length > 0) {
      return <RenderSlides {...props} />;
    }
    return (
      <PromotionBanner
        locale={ctx.locale}
        imageSrc={settings.image as string}
        heading={lt(settings.heading as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        subheading={lt(settings.subheading as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        ctaLabel={lt(settings.ctaLabel as LocalizedText, ctx.locale, ctx.defaultLanguage)}
        href={settings.link as string}
        fullWidth={settings.fullWidth as boolean}
      />
    );
  },
};
