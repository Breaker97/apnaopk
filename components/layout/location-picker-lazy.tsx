"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * Lazy boundary for the shopper location picker, which only listing and
 * category pages render but every storefront page used to download.
 * See product-details-lazy.tsx for why the boundary has to be a client
 * wrapper: a `dynamic()` inside a server section does not split.
 */
const LocationPicker = dynamic(() =>
  import("@/components/layout/location-picker").then((module) => module.LocationPicker),
);

export function LocationPickerLazy(props: ComponentProps<typeof LocationPicker>) {
  return <LocationPicker {...props} />;
}
