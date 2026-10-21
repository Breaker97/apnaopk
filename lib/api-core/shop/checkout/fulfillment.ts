import * as z from "zod";
import { CheckoutFulfillmentOptions } from "@/contracts/mobile/shop/v1/checkout";
import { defineRoute } from "@/lib/api-core/registry";
import { connectDB } from "@/lib/db";
import {
  pickupAvailabilityLocationDetails,
  pickupAvailabilityVendorDetails,
  pickupLocationAvailability,
  resolvePickupEligibility,
} from "@/lib/checkout/checkout-pickup";
import { pickupOpeningHoursSummary } from "@/lib/checkout/pickup-hours";

/** Seller policy and branches for the authenticated cart or the guest's X-Cart-Token. */
export const checkoutFulfillmentRoute = defineRoute({
  id: "checkout.fulfillment",
  method: "GET",
  path: "/checkout/fulfillment",
  auth: "optional",
  cache: { kind: "private" },
  rateLimit: { bucket: "checkout:fulfillment", preset: "lenient" },
  demo: "default",
  input: z.object({}),
  output: CheckoutFulfillmentOptions,
  handler: async ({ session, client }) => {
    await connectDB();
    const eligibility = await resolvePickupEligibility({ userId: session?.user.id, sessionId: client.cartToken });
    if (!eligibility.eligible) {
      return {
        deliveryAvailable: eligibility.deliveryAvailable === true,
        pickupAvailable: false,
        reason: eligibility.reason,
        locations: [],
      };
    }
    const locations = pickupLocationAvailability(eligibility).map((location) => ({
      ...pickupAvailabilityLocationDetails(location),
      available: location.available,
      openingHours: pickupOpeningHoursSummary(location),
    }));
    const pickupAvailable = locations.some((location) => location.available);
    return {
      deliveryAvailable: eligibility.deliveryAvailable !== false,
      pickupAvailable,
      ...(!pickupAvailable ? { reason: "out_of_stock" as const } : {}),
      vendor: pickupAvailabilityVendorDetails({ vendorId: eligibility.vendorId, vendorName: eligibility.vendorName }),
      locations,
    };
  },
});
