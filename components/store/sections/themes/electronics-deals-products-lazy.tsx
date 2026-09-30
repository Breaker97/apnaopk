"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the Electronics deals panel's product rail.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const ElectronicsDealsProducts = dynamic(() =>
  import("@/components/store/sections/themes/electronics-deals-products").then(
    (module) => module.ElectronicsDealsProducts,
  ),
);

export function ElectronicsDealsProductsLazy(
  props: ComponentProps<typeof ElectronicsDealsProducts>,
) {
  return <ElectronicsDealsProducts {...props} />;
}
