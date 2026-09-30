"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the category tiles (category list section, listing
 * pages' category row).
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const CategoryTiles = dynamic(() =>
  import("@/components/store/sections/category-tiles").then(
    (module) => module.CategoryTiles,
  ),
);

export function CategoryTilesLazy(props: ComponentProps<typeof CategoryTiles>) {
  return <CategoryTiles {...props} />;
}
