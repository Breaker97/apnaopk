"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the countdown offer section.
 * See product-details-lazy.tsx: a client component a section imports is
 * otherwise in the first-load JS of every storefront page, rendered or not.
 */
const CountdownOfferView = dynamic(() =>
  import("@/components/store/sections/countdown-offer-view").then(
    (module) => module.CountdownOfferView,
  ),
);

export function CountdownOfferViewLazy(
  props: ComponentProps<typeof CountdownOfferView>,
) {
  return <CountdownOfferView {...props} />;
}
