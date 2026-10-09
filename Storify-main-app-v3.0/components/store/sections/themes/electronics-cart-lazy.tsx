"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the Electronics cart template. The theme override map
 * imports it statically, which put the whole cart page in every storefront
 * page's first-load JS.
 * See product-details-lazy.tsx for why the boundary has to be a client
 * wrapper: a `dynamic()` inside a server section does not split.
 */
const ElectronicsCart = dynamic(() =>
  import("@/components/store/sections/themes/electronics-cart").then((module) => module.ElectronicsCart),
);

export function ElectronicsCartLazy(props: ComponentProps<typeof ElectronicsCart>) {
  return <ElectronicsCart {...props} />;
}
