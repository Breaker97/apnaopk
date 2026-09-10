import { withApi } from "@/lib/api/handler";
import { createRefreshTrackingHandler } from "@/lib/shipping/carriers/route-handlers";
import { vendorShipmentScope } from "@/lib/shipping/carriers/scopes";

/**
 * POST .../shipments/[shipmentId]/refresh-tracking
 *
 * Pulls the authoritative tracking state from the carrier. A POST because it
 * costs an upstream call, and rate-limited for the same reason.
 */
export const POST = withApi<{ id: string; shipmentId: string }>(
  {
    auth: "user",
    // A mutation despite the name — see the admin twin.
    demo: "block-mutations",
    rateLimit: { action: "vendor:orders:refresh-tracking", preset: "strict" },
  },
  createRefreshTrackingHandler(vendorShipmentScope),
);
