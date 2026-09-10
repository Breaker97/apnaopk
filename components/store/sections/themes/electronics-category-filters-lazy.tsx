"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the Electronics listing/category filter rail.
 * See product-details-lazy.tsx for why the boundary has to be a client
 * wrapper: a `dynamic()` inside a server section does not split.
 */
const ElectronicsCategoryFilters = dynamic(() =>
  import("@/components/store/sections/themes/electronics-category-filters").then((module) => module.ElectronicsCategoryFilters),
);

const ElectronicsCategoryFiltersMobile = dynamic(() =>
  import("@/components/store/sections/themes/electronics-category-filters").then((module) => module.ElectronicsCategoryFiltersMobile),
);

const FilterSection = dynamic(() =>
  import("@/components/store/sections/themes/electronics-category-filters").then((module) => module.FilterSection),
);

export function ElectronicsCategoryFiltersLazy(props: ComponentProps<typeof ElectronicsCategoryFilters>) {
  return <ElectronicsCategoryFilters {...props} />;
}

export function ElectronicsCategoryFiltersMobileLazy(props: ComponentProps<typeof ElectronicsCategoryFiltersMobile>) {
  return <ElectronicsCategoryFiltersMobile {...props} />;
}

export function FilterSectionLazy(props: ComponentProps<typeof FilterSection>) {
  return <FilterSection {...props} />;
}
