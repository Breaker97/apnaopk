"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundaries for the product browser section's two drawings — a page
 * loads only the one it renders, and a page without the section neither.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const HomeProductsSectionClient = dynamic(() =>
  import("@/components/store/home-products-section-client").then(
    (module) => module.HomeProductsSectionClient,
  ),
);

const HomeProductsSectionInfinite = dynamic(() =>
  import("@/components/store/home-products-section-infinite").then(
    (module) => module.HomeProductsSectionInfinite,
  ),
);

export function HomeProductsSectionClientLazy(
  props: ComponentProps<typeof HomeProductsSectionClient>,
) {
  return <HomeProductsSectionClient {...props} />;
}

export function HomeProductsSectionInfiniteLazy(
  props: ComponentProps<typeof HomeProductsSectionInfinite>,
) {
  return <HomeProductsSectionInfinite {...props} />;
}
