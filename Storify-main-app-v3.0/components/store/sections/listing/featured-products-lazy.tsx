"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the listing pages' featured products row.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const ListingFeaturedProducts = dynamic(() =>
  import("@/components/store/sections/listing/featured-products").then(
    (module) => module.ListingFeaturedProducts,
  ),
);

export function ListingFeaturedProductsLazy(
  props: ComponentProps<typeof ListingFeaturedProducts>,
) {
  return <ListingFeaturedProducts {...props} />;
}
