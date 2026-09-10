import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { notFoundResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { isValidObjectId } from "@/lib/api/validate";
import type { IOrder } from "@/types";
import { withApi } from "@/lib/api/handler";
import { generateOrderInvoicePdf } from "@/lib/orders/order-invoice";


/**
 * GET /api/admin/orders/[id]/invoice
 * Download invoice PDF for any order (admin/staff)
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_ORDERS],
    );

    await connectDB();

    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Order");

    const order = await Order.findOne(
      mergeScopeFilter({ _id: id }, buildStaffOrderScopeFilter(access.staffScope)),
    )
      .populate("customerId", "name email")
      .lean<IOrder & { customerId?: { name?: string; email?: string } }>();

    if (!order) {
      return notFoundResponse("Order");
    }

    const settings = await getSettingsLean();
    const customerName =
      order.customerId?.name || order.shippingAddress?.fullName || "Customer";
    const pdfBuffer = await generateOrderInvoicePdf(order, settings, customerName);

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${order.orderNumber}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  },
);
