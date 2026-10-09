"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the category page's subcategory row.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const SubcategoryScroller = dynamic(() =>
  import("@/components/store/sections/listing/subcategory-scroller").then(
    (module) => module.SubcategoryScroller,
  ),
);

export function SubcategoryScrollerLazy(
  props: ComponentProps<typeof SubcategoryScroller>,
) {
  return <SubcategoryScroller {...props} />;
}
