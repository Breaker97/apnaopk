"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the product page's related and sponsored rails.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const RelatedProductsCarousel = dynamic(() =>
  import("@/components/products/related-products-carousel").then(
    (module) => module.RelatedProductsCarousel,
  ),
);

export function RelatedProductsCarouselLazy(
  props: ComponentProps<typeof RelatedProductsCarousel>,
) {
  return <RelatedProductsCarousel {...props} />;
}
