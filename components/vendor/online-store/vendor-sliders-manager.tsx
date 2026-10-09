"use client";

import type { ComponentProps } from "react";
import { SlidersManager } from "@/components/admin/sliders/sliders-manager";
import {
  StoreBuilderScopeProvider,
  VENDOR_STORE_BUILDER_SCOPE,
} from "@/components/admin/store-pages/builder-scope";

/**
 * Online Store → Sliders for a vendor: the admin's Sliders screen, run on
 * the vendor's own routes (/api/vendor/sliders) through the vendor scope —
 * their products only, no AI copy, no store-wide template shelf or stats.
 */
export function VendorSlidersManager(
  props: ComponentProps<typeof SlidersManager>,
) {
  return (
    <StoreBuilderScopeProvider value={VENDOR_STORE_BUILDER_SCOPE}>
      <SlidersManager {...props} />
    </StoreBuilderScopeProvider>
  );
}
