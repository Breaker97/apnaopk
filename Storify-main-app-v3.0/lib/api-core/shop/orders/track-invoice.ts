import * as z from "zod";
import { TrackOrderRequest } from "@/contracts/mobile/shop/v1/orders";
import { FileBody } from "@/lib/api-core/http";
import { defineRoute } from "@/lib/api-core/registry";
import { buildGuestInvoicePdf } from "@/lib/orders/guest-order-tracking";
import { findTrackedOrder } from "./track";

/**
 * POST /orders/track/invoice: the invoice of an order a guest found, the same
 * PDF the website's tracking page downloads for them. It counts against the
 * same per-order limit as POST /orders/track.
 */
export const orderTrackInvoiceRoute = defineRoute({
  id: "orders.track.invoice",
  method: "POST",
  path: "/orders/track/invoice",
  auth: "none",
  cache: { kind: "private" },
  rateLimit: { bucket: "orders:track-invoice", preset: "strict" },
  demo: "default",
  input: TrackOrderRequest,
  output: z.instanceof(FileBody),
  handler: async ({ input, client }) => {
    const order = await findTrackedOrder(input, client.ip);
    const pdf = await buildGuestInvoicePdf(order);
    return new FileBody(new Uint8Array(pdf), "application/pdf", `invoice-${order.orderNumber}.pdf`);
  },
});
