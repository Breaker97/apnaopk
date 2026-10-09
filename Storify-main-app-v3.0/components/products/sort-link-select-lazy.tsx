"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the collection and brand pages' sort dropdown, which
 * brings the select primitive with it.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const SortLinkSelect = dynamic(() =>
  import("@/components/products/sort-link-select").then(
    (module) => module.SortLinkSelect,
  ),
);

export function SortLinkSelectLazy(props: ComponentProps<typeof SortLinkSelect>) {
  return <SortLinkSelect {...props} />;
}
