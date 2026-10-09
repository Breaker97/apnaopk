import { withApi } from "@/lib/api/handler";
import { createLabelHandler } from "@/lib/shipping/carriers/route-handlers";
import { adminShipmentScope } from "@/lib/shipping/carriers/scopes";

/**
 * GET .../shipments/[shipmentId]/label
 *
 * Streams the label. Proxied rather than redirected so the carrier URL never
 * reaches the browser and QZ Tray gets a same-origin blob.
 */
export const GET = withApi<{ id: string; shipmentId: string }>(
  { auth: "user" },
  createLabelHandler(adminShipmentScope),
);
