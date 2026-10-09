import { isStorefrontBrandShown } from "@/lib/brands/storefront-brands";
import { storefrontResourceGate } from "@/lib/storefront/resource-gate";

// A brand the storefront does not show answers 404 before the page streams.
export default storefrontResourceGate(isStorefrontBrandShown);
