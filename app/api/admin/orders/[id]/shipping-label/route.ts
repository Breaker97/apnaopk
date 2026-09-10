import { Order, Shipment } from "@/models";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { shipmentItemsForOrder } from "@/lib/shipping/shipments";
import { generateShippingLabelPdf } from "@/lib/shipping/shipping-label-pdf";
import type { IOrder } from "@/types";

export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_ORDERS],
    );
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");
    const order = await Order.findOne(
      mergeScopeFilter({ _id: params.id }, buildStaffOrderScopeFilter(access.staffScope)),
    ).lean<IOrder>();
    if (!order) return notFoundResponse("Order");
    const shipmentId = new URL(request.url).searchParams.get("shipmentId");
    const shipment = shipmentId && isValidObjectId(shipmentId)
      ? await Shipment.findOne({ _id: shipmentId, orderId: order._id }).lean()
      : await Shipment.findOne({ orderId: order._id }).sort({ createdAt: -1 }).lean();
    if (!shipment) return notFoundResponse("Shipment");

    const vendorId = shipment.vendorId ? String(shipment.vendorId) : undefined;
    const items = shipmentItemsForOrder(order, vendorId);
    const pdf = await generateShippingLabelPdf({
      orderNumber: order.orderNumber,
      carrier: shipment.carrier,
      service: shipment.service,
      trackingNumber: shipment.trackingNumber,
      from: {
        name: shipment.shipFrom.fullName || "Store",
        street: shipment.shipFrom.street,
        apartment: shipment.shipFrom.apartment,
        city: shipment.shipFrom.city,
        state: shipment.shipFrom.state,
        postalCode: shipment.shipFrom.postalCode,
        country: shipment.shipFrom.country,
        phone: shipment.shipFrom.phone,
      },
      to: {
        name: shipment.shipTo.fullName || "Customer",
        street: shipment.shipTo.street,
        apartment: shipment.shipTo.apartment,
        city: shipment.shipTo.city,
        state: shipment.shipTo.state,
        postalCode: shipment.shipTo.postalCode,
        country: shipment.shipTo.country,
        phone: shipment.shipTo.phone,
      },
      items: items.map((item) => ({ name: item.name, sku: item.sku, quantity: item.quantity })),
      parcel: shipment.parcel,
      internalLabel: shipment.label.source === "internal",
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="shipping-label-${order.orderNumber}.pdf"`,
        "Cache-Control": "no-store, private",
      },
    });
  },
);

