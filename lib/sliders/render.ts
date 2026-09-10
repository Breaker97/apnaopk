import type { SliderSlide } from "./types";

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
 * server resolved. Pure mapping (no server imports) so the money invariant —
 * price exists ONLY when a bound product resolved — stays unit-testable.
 */
export interface RenderSliderSlide extends SliderSlide {
  price?: { amount: number; compareAt?: number };
  href?: string;
}

export function buildRenderSlides(
  slides: SliderSlide[],
  products: Map<string, SlideProductInfo>,
): RenderSliderSlide[] {
  return slides
    .filter((slide) => slide.visible)
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
        price,
        href:
          slide.link || (product ? `/products/${product.slug}` : undefined),
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
