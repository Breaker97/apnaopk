import { Order, Shipment } from "@/models";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { generateShippingLabelPdf } from "@/lib/shipping/shipping-label-pdf";
import { labelCashOnDelivery } from "@/lib/shipping/carriers/build-request";
import type { IOrder } from "@/types";

export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const user = session.user;
    const allowed = await hasVendorPermission(user, VENDOR_PERMISSIONS.VIEW_ORDERS);
    if (!allowed && !isAdmin(user)) throw new AuthorizationError();
    const vendor = await requireApprovedVendorByUserId(session.user.id);
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");
    const order = await Order.findOne({
      _id: params.id,
      "subOrders.vendorId": vendor._id,
    }).lean<IOrder>();
    if (!order) return notFoundResponse("Order");
    const shipmentId = new URL(request.url).searchParams.get("shipmentId");
    const shipment = shipmentId && isValidObjectId(shipmentId)
      ? await Shipment.findOne({ _id: shipmentId, orderId: order._id, vendorId: vendor._id }).lean()
      : await Shipment.findOne({ orderId: order._id, vendorId: vendor._id }).sort({ createdAt: -1 }).lean();
    if (!shipment) return notFoundResponse("Shipment");
    const subOrder = order.subOrders.find(
      (entry) => String(entry.vendorId) === String(vendor._id),
    );
    if (subOrder?.fulfillment?.method === "pickup") {
      throw new ValidationError("Pickup orders do not use shipping labels");
    }
    const items = subOrder?.items || [];
    const pdf = await generateShippingLabelPdf({
      orderNumber: order.orderNumber,
      carrier: shipment.carrier,
      service: shipment.service,
      trackingNumber: shipment.trackingNumber,
      from: {
        name: shipment.shipFrom.fullName || vendor.storeName,
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
      cashOnDelivery: await labelCashOnDelivery(order, subOrder),
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

