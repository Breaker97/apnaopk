import { withApi } from "@/lib/api/handler";
import { createRefreshTrackingHandler } from "@/lib/shipping/carriers/route-handlers";
import { adminShipmentScope } from "@/lib/shipping/carriers/scopes";

/**
 * POST .../shipments/[shipmentId]/refresh-tracking
 *
 * Pulls the authoritative tracking state from the carrier. A POST because it
 * costs an upstream call, and rate-limited for the same reason.
 */
export const POST = withApi<{ id: string; shipmentId: string }>(
  {
    auth: "user",
    // A mutation despite the name: it rewrites the parcel's status and event
    // log, and can cascade the order to shipped or delivered. A demo instance
    // ships a publicly known admin login, so it must not drive real orders from
    // whatever carrier account happens to be configured.
    demo: "block-mutations",
    rateLimit: { action: "admin:orders:refresh-tracking", preset: "strict" },
  },
  createRefreshTrackingHandler(adminShipmentScope),
);
