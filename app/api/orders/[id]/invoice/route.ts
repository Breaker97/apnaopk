import { mongoose } from "@/lib/db";
import { Order } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import type { IOrder } from "@/types";
import { withApi } from "@/lib/api/handler";
import { generateOrderInvoicePdf } from "@/lib/orders/order-invoice";


/**
 * GET /api/orders/[id]/invoice
 * Download invoice PDF for an order
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ params, session }) => {
    const { id } = params;

    // Support lookup by ObjectId or orderNumber
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    const query = isObjectId
      ? { _id: id, customerId: session.user.id }
      : { orderNumber: id, customerId: session.user.id };

    const order = await Order.findOne(query)
      .populate("customerId", "name email")
      .lean<IOrder & { customerId?: { name?: string; email?: string } }>();

    if (!order) {
      return new Response("Order not found", { status: 404 });
    }

    const settings = await getSettingsLean();
    const customerName =
      order.customerId?.name || session.user.name || "Customer";
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
