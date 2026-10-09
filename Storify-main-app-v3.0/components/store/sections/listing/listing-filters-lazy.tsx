"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the listing filter rail (products and category pages).
 * See product-details-lazy.tsx for why the boundary has to be a client
 * wrapper: a `dynamic()` inside a server section does not split.
 */
const ListingFilters = dynamic(() =>
  import("@/components/store/sections/listing/listing-filters").then(
    (module) => module.ListingFilters,
  ),
);

const ListingFiltersMobile = dynamic(() =>
  import("@/components/store/sections/listing/listing-filters").then(
    (module) => module.ListingFiltersMobile,
  ),
);

const FilterSection = dynamic(() =>
  import("@/components/store/sections/listing/listing-filters").then(
    (module) => module.FilterSection,
  ),
);

export function ListingFiltersLazy(props: ComponentProps<typeof ListingFilters>) {
  return <ListingFilters {...props} />;
}

export function ListingFiltersMobileLazy(
  props: ComponentProps<typeof ListingFiltersMobile>,
) {
  return <ListingFiltersMobile {...props} />;
}

export function FilterSectionLazy(props: ComponentProps<typeof FilterSection>) {
  return <FilterSection {...props} />;
}
