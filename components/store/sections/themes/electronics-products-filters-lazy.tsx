"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the Electronics products-page filter rail.
 * See product-details-lazy.tsx for why the boundary has to be a client
 * wrapper: a `dynamic()` inside a server section does not split.
 */
const ElectronicsProductsFilters = dynamic(() =>
  import("@/components/store/sections/themes/electronics-products-filters").then((module) => module.ElectronicsProductsFilters),
);

const ElectronicsProductsFiltersMobile = dynamic(() =>
  import("@/components/store/sections/themes/electronics-products-filters").then((module) => module.ElectronicsProductsFiltersMobile),
);

export function ElectronicsProductsFiltersLazy(props: ComponentProps<typeof ElectronicsProductsFilters>) {
  return <ElectronicsProductsFilters {...props} />;
}

export function ElectronicsProductsFiltersMobileLazy(props: ComponentProps<typeof ElectronicsProductsFiltersMobile>) {
  return <ElectronicsProductsFiltersMobile {...props} />;
}
