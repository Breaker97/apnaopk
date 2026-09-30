import { getStorefrontVendorBySlug } from "@/lib/storefront/storefront-vendors";
import { storefrontResourceGate } from "@/lib/storefront/resource-gate";

// A seller the storefront does not show answers 404 before the page streams.
export default storefrontResourceGate(getStorefrontVendorBySlug);
