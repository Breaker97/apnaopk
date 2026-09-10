import { z } from "zod";
import { Order, Shipment, Vendor } from "@/models";
import { getSettings } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { completeAddress, shipFromAddress } from "@/lib/shipping/shipments";
import { createAuditContext } from "@/lib/audit";
import { auditOrderShipment } from "@/lib/orders/audit-order";
import { applyShipmentTrackingToOrder } from "@/lib/shipping/tracking-cascade";
import { createListHandler } from "@/lib/shipping/carriers/route-handlers";
import { adminShipmentScope } from "@/lib/shipping/carriers/scopes";

const ShipmentSchema = z.object({
  carrier: z.string().trim().max(100).optional(),
  service: z.string().trim().max(100).optional(),
  trackingNumber: z.string().trim().max(120).optional(),
  subOrderId: z.string().optional(),
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

/**
 * Returns the order's shipments plus the carrier context the shipments card
 * needs (whether carriers are on, the box catalogue, the store currency) so
 * the panel renders from one round trip instead of three.
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  createListHandler(adminShipmentScope),
);

export const POST = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");
    const body = await validateBody(request, ShipmentSchema);
    const order = await Order.findOne(
      mergeScopeFilter({ _id: params.id }, buildStaffOrderScopeFilter(access.staffScope)),
    ).lean();
    if (!order) return notFoundResponse("Order");

    const subOrder = body.subOrderId
      ? order.subOrders?.find(
          (entry: { _id?: unknown }) => String(entry._id) === body.subOrderId,
        )
      : undefined;
    if (body.subOrderId && !subOrder) return notFoundResponse("Sub-order");

    const settings = await getSettings();
    const carrier = body.carrier || order.carrier || "Internal fulfillment";
    const trackingNumber =
      body.trackingNumber || subOrder?.trackingNumber || order.trackingNumber || order.orderNumber;
    const vendorId = subOrder?.vendorId;
    // The parcel leaves the sub-order's vendor, not "the store" — in
    // single-vendor mode that is the default vendor, whose origin already
    // mirrors settings.shipping.origin. Falling back to the settings alone
    // keeps a shipment created without a sub-order working.
    const vendor = vendorId
      ? await Vendor.findById(vendorId).select("storeName address shipping").lean()
      : null;
    const shipment = await Shipment.findOneAndUpdate(
      {
        orderId: order._id,
        vendorId: vendorId || null,
        trackingNumber,
      },
      {
        $set: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          vendorId,
          subOrderId: subOrder?._id,
          carrier,
          service: body.service || order.shippingMethod?.name,
          trackingNumber,
          status: order.status === "shipped" ? "shipped" : "label_ready",
          source: "manual",
          shipFrom: shipFromAddress({ vendor, settings }),
          shipTo: completeAddress(order.shippingAddress, "Customer"),
          parcel: body.parcel || {},
          label: { source: "internal", format: "pdf" },
          createdBy: session.user.id,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );

    // A tracking number typed in here is the merchant recording a real parcel
    // on a store with no carrier account, so it belongs on the order the same
    // way a purchased label's does — otherwise it lived only on the shipment
    // row and the customer's tracking page showed nothing to track. The status
    // is deliberately left alone: recording a parcel is not the same event as
    // dispatching it, and "Mark as shipped" is a separate, explicit action.
    //
    // The order number is excluded because the label buttons post it as a
    // stand-in whenever no AWB has been entered — an internal label needs
    // *something* to print. Publishing that to the customer would hand them an
    // order number to type into a courier's website that has never heard of it.
    if (body.trackingNumber && body.trackingNumber !== order.orderNumber) {
      await applyShipmentTrackingToOrder({
        orderId: String(order._id),
        subOrderId: subOrder?._id ? String(subOrder._id) : undefined,
        trackingNumber,
        carrier: body.carrier || undefined,
      }).catch(console.error);
    }

    // Upsert keyed on {orderId, vendorId, trackingNumber} — re-clicking
    // "Shipping label" for the same parcel updates that row rather than
    // creating another, so this does not spam the timeline.
    await auditOrderShipment(createAuditContext(request, session), order, {
      carrier,
      trackingNumber,
    });

    return successResponse(shipment);
  },
);
