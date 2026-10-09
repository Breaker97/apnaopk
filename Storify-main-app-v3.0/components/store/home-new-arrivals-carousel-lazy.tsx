"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the product rail (product grid and sponsored rail).
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const HomeNewArrivalsCarousel = dynamic(() =>
  import("@/components/store/home-new-arrivals-carousel").then(
    (module) => module.HomeNewArrivalsCarousel,
  ),
);

export function HomeNewArrivalsCarouselLazy(
  props: ComponentProps<typeof HomeNewArrivalsCarousel>,
) {
  return <HomeNewArrivalsCarousel {...props} />;
}
