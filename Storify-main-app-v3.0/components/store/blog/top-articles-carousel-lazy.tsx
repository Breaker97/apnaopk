"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the blog posts section's carousel.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const TopArticlesCarousel = dynamic(() =>
  import("@/components/store/blog/top-articles-carousel").then(
    (module) => module.TopArticlesCarousel,
  ),
);

export function TopArticlesCarouselLazy(
  props: ComponentProps<typeof TopArticlesCarousel>,
) {
  return <TopArticlesCarousel {...props} />;
}
