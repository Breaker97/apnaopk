"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the top vendors carousel.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const HomeTopVendorsCarousel = dynamic(() =>
  import("@/components/store/home-top-vendors-carousel").then(
    (module) => module.HomeTopVendorsCarousel,
  ),
);

export function HomeTopVendorsCarouselLazy(
  props: ComponentProps<typeof HomeTopVendorsCarousel>,
) {
  return <HomeTopVendorsCarousel {...props} />;
}
