"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the product group section's tabs.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const ProductGroupTabs = dynamic(() =>
  import("@/components/store/sections/product-group-tabs").then(
    (module) => module.ProductGroupTabs,
  ),
);

export function ProductGroupTabsLazy(
  props: ComponentProps<typeof ProductGroupTabs>,
) {
  return <ProductGroupTabs {...props} />;
}
