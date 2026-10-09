import * as z from "zod";
import { defineRoute } from "@/lib/api-core/registry";
import { FileBody } from "@/lib/api-core/http";
import { generateOrderInvoicePdf } from "@/lib/orders/order-invoice";
import { getSettingsLean } from "@/models/settings.model";
import { findCustomerOrder } from "./detail";

/**
 * GET /orders/{id}/invoice: the invoice's PDF itself, the one the website's
 * order page downloads. The app fetches it with its session and hands it to
 * the system's share sheet.
 */
export const orderInvoiceRoute = defineRoute({
  id: "orders.invoice",
  method: "GET",
  path: "/orders/{id}/invoice",
  auth: "user",
  cache: { kind: "private" },
  output: z.instanceof(FileBody),
  handler: async ({ params, session }) => {
    const [order, settings] = await Promise.all([
      findCustomerOrder(params.id, session.user.id),
      getSettingsLean(),
    ]);
    // The account's own name: the order's customer is the signed-in shopper.
    const pdf = await generateOrderInvoicePdf(order, settings, session.user.name || "Customer");
    return new FileBody(new Uint8Array(pdf), "application/pdf", `invoice-${order.orderNumber}.pdf`);
  },
});
