"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the listing sort control and its select.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const ProductsSort = dynamic(() =>
  import("@/components/products/products-sort").then(
    (module) => module.ProductsSort,
  ),
);

export function ProductsSortLazy(props: ComponentProps<typeof ProductsSort>) {
  return <ProductsSort {...props} />;
}
