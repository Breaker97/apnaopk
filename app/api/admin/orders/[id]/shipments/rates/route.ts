import { withApi } from "@/lib/api/handler";
import { createRateShopHandler } from "@/lib/shipping/carriers/route-handlers";
import { adminShipmentScope } from "@/lib/shipping/carriers/scopes";

/**
 * POST .../shipments/rates
 *
 * Rate-shops the sub-order and stores the quotes on a draft shipment. A POST,
 * and demo-blocked, despite reading like a query: it spends a real carrier API
 * call and creates the draft the purchase step redeems.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "admin:orders:rates", preset: "strict" },
  },
  createRateShopHandler(adminShipmentScope),
);
