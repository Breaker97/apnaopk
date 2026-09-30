import { getStorefrontCategoryBySlug } from "@/lib/storefront/storefront-categories";
import { storefrontResourceGate } from "@/lib/storefront/resource-gate";

// A category the storefront does not show answers 404 before the page streams.
export default storefrontResourceGate(getStorefrontCategoryBySlug);
