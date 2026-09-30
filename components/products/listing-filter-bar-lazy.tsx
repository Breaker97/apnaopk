"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the listing filter bar (products page).
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const ListingFilterBar = dynamic(() =>
  import("@/components/products/listing-filter-bar").then(
    (module) => module.ListingFilterBar,
  ),
);

export function ListingFilterBarLazy(
  props: ComponentProps<typeof ListingFilterBar>,
) {
  return <ListingFilterBar {...props} />;
}
