/**
 * GET /api/orders/[id]/downloads
 *
 * List the digital files this order entitles the signed-in customer to,
 * with per-file usage against the product's download limit. Files are only
 * entitled once the order is fully paid.
 */

import { isValidObjectId } from "@/lib/api/validate";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { Order } from "@/models";
import {
  getOrderDigitalEntitlements,
  isOrderEntitledToDownloads,
} from "@/lib/orders/order-digital-downloads";

export const GET = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "orders:downloads:list", preset: "lenient" } },
  async ({ params, session }) => {
    const { id } = params;

    // Accept the Mongo _id or the orderNumber — the checkout success page
    // often only has the latter (mirrors the invoice route).
    const order = await Order.findOne({
      ...(isValidObjectId(id) ? { _id: id } : { orderNumber: id }),
      customerId: session.user.id,
    })
      .select("items paymentStatus digitalDownloads subOrders.vendorId subOrders.status subOrders.paymentStatus")
      .lean();
    if (!order) return notFoundResponse("Order");

    const entitled = isOrderEntitledToDownloads(order);
    const files = entitled ? await getOrderDigitalEntitlements(order) : [];

    return successResponse({ entitled, files });
  },
);
