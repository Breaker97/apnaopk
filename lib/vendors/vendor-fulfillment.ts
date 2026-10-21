/** Seller choices for physical orders. Branch availability is checked separately. */
export const VENDOR_FULFILLMENT_MODES = ["delivery", "pickup", "both"] as const;
export type VendorFulfillmentMode = (typeof VENDOR_FULFILLMENT_MODES)[number];
export const VENDOR_PICKUP_ONLY_MESSAGE =
  "Some items are pickup only. Choose pickup, or place separate orders for each store.";

/** Existing sellers keep delivery and any pickup branches they already offer. */
export function resolveVendorFulfillmentMode(value: unknown): VendorFulfillmentMode {
  return value === "delivery" || value === "pickup" ? value : "both";
}

export function vendorAllowsDelivery(value: unknown): boolean {
  return resolveVendorFulfillmentMode(value) !== "pickup";
}

export function vendorAllowsPickup(value: unknown): boolean {
  return resolveVendorFulfillmentMode(value) !== "delivery";
}

/** Keep a shopper's choice when allowed, otherwise select the remaining option. */
export function availableFulfillmentMethod(
  current: "delivery" | "pickup",
  options: { deliveryAvailable: boolean; pickupAvailable: boolean },
): "delivery" | "pickup" | null {
  if (current === "delivery" && options.deliveryAvailable) return current;
  if (current === "pickup" && options.pickupAvailable) return current;
  if (options.deliveryAvailable) return "delivery";
  if (options.pickupAvailable) return "pickup";
  return null;
}
