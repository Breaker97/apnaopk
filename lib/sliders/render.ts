import { slideIsLive, type SliderSlide, type SlideTextElement } from "./types";

/** What the server resolved for a bound product. */
export interface SlideProductInfo {
  slug: string;
  /** Minimum sell price (variant-aware), in store currency units. */
  priceMin: number;
  /** Highest compare-at, only when it actually beats priceMin. */
  compareAtMax?: number;
}

/**
 * A slide as the storefront renders it: the stored slide plus everything the
 * server resolved — the price, the links, and the copy in the shopper's
 * language. Pure mapping (no server imports) so the money invariant — price
 * exists ONLY when a bound product resolved — stays unit-testable.
 */
export interface RenderSliderSlide extends SliderSlide {
  price?: { amount: number; compareAt?: number };
  href?: string;
  /** The second button's destination; nothing falls back to it. */
  href2?: string;
}

export interface BuildRenderOptions {
  /** The shopper's locale; the copy falls back to the default language. */
  locale?: string;
  /** The instant the schedule is judged at; defaults to now. */
  now?: Date;
}

/** The slide's texts in one locale, the default language filling any gap. */
export function localizedSlideTexts(
  slide: SliderSlide,
  locale: string | undefined,
): SliderSlide["texts"] {
  const own = locale ? slide.translations?.[locale] : undefined;
  if (!own) return slide.texts;
  const texts = { ...slide.texts };
  for (const element of Object.keys(own) as SlideTextElement[]) {
    const text = own[element];
    if (text) texts[element] = text;
  }
  return texts;
}

export function buildRenderSlides(
  slides: SliderSlide[],
  products: Map<string, SlideProductInfo>,
  options: BuildRenderOptions = {},
): RenderSliderSlide[] {
  const now = options.now ?? new Date();
  return slides
    .filter((slide) => slide.visible && slideIsLive(slide, now))
    .map((slide) => {
      const product = slide.productId
        ? products.get(slide.productId)
        : undefined;
      const price =
        product && slide.elements.price
          ? {
              amount: product.priceMin,
              ...(product.compareAtMax !== undefined &&
              product.compareAtMax > product.priceMin
                ? { compareAt: product.compareAtMax }
                : {}),
            }
          : undefined;
      return {
        ...slide,
        texts: localizedSlideTexts(slide, options.locale),
        price,
        href:
          slide.link || (product ? `/products/${product.slug}` : undefined),
        href2: slide.link2 || undefined,
      };
    });
}

/** Distinct product ids the server needs to resolve for a slide list. */
export function collectSlideProductIds(slides: SliderSlide[]): string[] {
  return Array.from(
    new Set(
      slides
        .filter((slide) => slide.visible)
        .map((slide) => slide.productId)
        .filter((id) => id.length > 0),
    ),
  );
}
