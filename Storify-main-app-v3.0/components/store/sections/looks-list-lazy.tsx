"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the looks list.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const LooksList = dynamic(() =>
  import("@/components/store/sections/looks-list").then(
    (module) => module.LooksList,
  ),
);

export function LooksListLazy(props: ComponentProps<typeof LooksList>) {
  return <LooksList {...props} />;
}
