"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundaries for the listing grids (paged and infinite).
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const ProductGridClient = dynamic(() =>
  import("@/components/products/product-grid-client").then(
    (module) => module.ProductGridClient,
  ),
);

const ProductGridInfinite = dynamic(() =>
  import("@/components/products/product-grid-infinite").then(
    (module) => module.ProductGridInfinite,
  ),
);

export function ProductGridClientLazy(
  props: ComponentProps<typeof ProductGridClient>,
) {
  return <ProductGridClient {...props} />;
}

export function ProductGridInfiniteLazy(
  props: ComponentProps<typeof ProductGridInfinite>,
) {
  return <ProductGridInfinite {...props} />;
}
