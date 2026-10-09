"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/** Lazy boundary for the slider runtime — see product-details-lazy.tsx. */
const SavedSlider = dynamic(() =>
  import("@/components/store/saved-slider").then((module) => module.SavedSlider),
);

export function SavedSliderLazy(props: ComponentProps<typeof SavedSlider>) {
  return <SavedSlider {...props} />;
}
