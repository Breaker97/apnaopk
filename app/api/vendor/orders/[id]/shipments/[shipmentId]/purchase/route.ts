import { withApi } from "@/lib/api/handler";
import { createPurchaseHandler } from "@/lib/shipping/carriers/route-handlers";
import { vendorShipmentScope } from "@/lib/shipping/carriers/scopes";

/** POST .../shipments/[shipmentId]/purchase — buys the chosen rate. */
export const POST = withApi<{ id: string; shipmentId: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:orders:buy-label", preset: "strict" },
  },
  createPurchaseHandler(vendorShipmentScope),
);
