"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the base listing filter sidebar (desktop).
 * See product-details-lazy.tsx for why the boundary has to be a client
 * wrapper: a `dynamic()` inside a server section does not split.
 */
const ProductFilters = dynamic(() =>
  import("@/components/products/product-filters").then((module) => module.ProductFilters),
);

export function ProductFiltersLazy(props: ComponentProps<typeof ProductFilters>) {
  return <ProductFilters {...props} />;
}
