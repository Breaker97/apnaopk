import { z } from "zod";
import { Order, Shipment } from "@/models";
import { getSettings } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { hasVendorPermission, isAdmin } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { completeAddress, shipFromAddress } from "@/lib/shipping/shipments";
import { createAuditContext } from "@/lib/audit";
import { auditOrderShipment } from "@/lib/orders/audit-order";
import { applyShipmentTrackingToOrder } from "@/lib/shipping/tracking-cascade";
import { createListHandler } from "@/lib/shipping/carriers/route-handlers";
import { vendorShipmentScope } from "@/lib/shipping/carriers/scopes";
import type { IVendor } from "@/types";

const ShipmentSchema = z.object({
  carrier: z.string().trim().max(100).optional(),
  service: z.string().trim().max(100).optional(),
  trackingNumber: z.string().trim().max(120).optional(),
  parcel: z
    .object({
      weight: z.number().min(0).optional(),
      weightUnit: z.enum(["g", "kg", "lb", "oz"]).optional(),
      length: z.number().min(0).optional(),
      width: z.number().min(0).optional(),
      height: z.number().min(0).optional(),
      dimensionUnit: z.enum(["cm", "in"]).optional(),
    })
    .optional(),
});

async function vendorAccess(session: { user: { id: string; role: string } }, permission: string) {
  const user = session.user;
  const allowed = await hasVendorPermission(
    user,
    permission as (typeof VENDOR_PERMISSIONS)[keyof typeof VENDOR_PERMISSIONS],
  );
  if (!allowed && !isAdmin(user)) throw new AuthorizationError();
  return requireApprovedVendorByUserId(session.user.id);
}

/** Mirrors the admin listing, scoped to this vendor's own parcels. */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  createListHandler(vendorShipmentScope),
);

export const POST = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const vendor = await vendorAccess(session, VENDOR_PERMISSIONS.EDIT_ORDERS);
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");
    const body = await validateBody(request, ShipmentSchema);
    const order = await Order.findOne({
      _id: params.id,
      "subOrders.vendorId": vendor._id,
    }).lean();
    if (!order) return notFoundResponse("Order");
    const subOrder = order.subOrders.find(
      (entry: { vendorId?: unknown }) =>
        String(entry.vendorId) === String(vendor._id),
    );
    if (!subOrder) return notFoundResponse("Sub-order");
    if (subOrder.fulfillment?.method === "pickup") {
      throw new ValidationError("Pickup orders do not use shipping labels");
    }
    const carrier = body.carrier || "Internal fulfillment";
    const trackingNumber =
      body.trackingNumber || subOrder.trackingNumber || order.orderNumber;
    // A vendor that has configured no origin of its own dispatches from the
    // store's, rather than from a blank address the carrier would reject.
    const settings = await getSettings();
    const shipment = await Shipment.findOneAndUpdate(
      { orderId: order._id, vendorId: vendor._id, trackingNumber },
      {
        $set: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          vendorId: vendor._id,
          subOrderId: subOrder._id,
          carrier,
          service: body.service || subOrder.shippingMethod?.name,
          trackingNumber,
          status: subOrder.status === "shipped" ? "shipped" : "label_ready",
          source: "manual",
          shipFrom: shipFromAddress({
            vendor: vendor as unknown as IVendor,
            settings,
          }),
          shipTo: completeAddress(order.shippingAddress, "Customer"),
          parcel: body.parcel || {},
          label: { source: "internal", format: "pdf" },
          createdBy: session.user.id,
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true },
    );

    // Mirrors the admin route: a hand-entered AWB is a real parcel and belongs
    // on the order, which is what the public tracking page reads. The status is
    // left alone — marking the consignment shipped is a separate action, and
    // the order number is excluded because the label buttons post it as a
    // stand-in when no AWB exists.
    if (body.trackingNumber && body.trackingNumber !== order.orderNumber) {
      await applyShipmentTrackingToOrder({
        orderId: String(order._id),
        subOrderId: subOrder._id ? String(subOrder._id) : undefined,
        trackingNumber,
        carrier: body.carrier || undefined,
      }).catch(console.error);
    }

    // On a split order several vendors ship independently, so the timeline
    // says whose parcel this is.
    await auditOrderShipment(createAuditContext(request, session), order, {
      carrier,
      trackingNumber,
      vendorName: vendor.storeName || undefined,
    });

    return successResponse(shipment);
  },
);
