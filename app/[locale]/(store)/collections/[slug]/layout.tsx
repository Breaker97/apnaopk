import { isStorefrontCollectionShown } from "@/lib/storefront/storefront-collections";
import { storefrontResourceGate } from "@/lib/storefront/resource-gate";

// A collection the storefront does not show answers 404 before the page streams.
export default storefrontResourceGate(isStorefrontCollectionShown);
