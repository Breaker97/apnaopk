"use client";

import type { ReactNode } from "react";
import { useVendorSignupVisible } from "@/hooks/use-vendor-signup-visible";

/**
 * Renders a "Become a Vendor" invitation only for the guests and shoppers it
 * is meant for (lib/vendors/vendor-signup-links.ts).
 */
export function VendorSignupGate({ children }: { children: ReactNode }) {
  return useVendorSignupVisible() ? children : null;
}
