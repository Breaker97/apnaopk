"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the base listing filter sheet (mobile).
 * See product-details-lazy.tsx for why the boundary has to be a client
 * wrapper: a `dynamic()` inside a server section does not split.
 */
const ProductFiltersMobile = dynamic(() =>
  import("@/components/products/product-filters-mobile").then((module) => module.ProductFiltersMobile),
);

export function ProductFiltersMobileLazy(props: ComponentProps<typeof ProductFiltersMobile>) {
  return <ProductFiltersMobile {...props} />;
}
