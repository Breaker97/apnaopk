import { withApi } from "@/lib/api/handler";
import { createVoidHandler } from "@/lib/shipping/carriers/route-handlers";
import { vendorShipmentScope } from "@/lib/shipping/carriers/scopes";

/** POST .../shipments/[shipmentId]/void — cancels a bought label. */
export const POST = withApi<{ id: string; shipmentId: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:orders:void-label", preset: "strict" },
  },
  createVoidHandler(vendorShipmentScope),
);
