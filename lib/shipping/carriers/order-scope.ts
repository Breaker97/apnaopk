import "server-only";

import { Order, User } from "@/models";
import { Shipment, type IShipment } from "@/models/shipment.model";
import { NotFoundError, AuthorizationError } from "@/lib/api/errors";
import type { IOrder, SubOrder } from "@/types";

/**
 * Loading an order for a carrier action, with the right rows visible.
 *
 * Admin and vendor differ only in which orders they may see and which
 * sub-order they act on, so that difference is a parameter rather than a
 * second copy of every route.
 */

export interface ShipmentScope {
  order: IOrder;
  subOrder: SubOrder;
  customerEmail?: string;
  /** Vendor id when the caller is a vendor; undefined for admin/staff. */
  vendorId?: string;
}

export async function loadShipmentScope(params: {
  orderId: string;
  /** Extra filter applied to the order query (staff scope, or vendor match). */
  orderFilter?: Record<string, unknown>;
  /** Picks the sub-order. Vendors are pinned to their own. */
  subOrderId?: string;
  vendorId?: string;
}): Promise<ShipmentScope> {
  const order = await Order.findOne({
    _id: params.orderId,
    ...(params.orderFilter || {}),
  }).lean<IOrder | null>();
  if (!order) throw new NotFoundError("Order");

  const subOrders = order.subOrders || [];
  let subOrder: SubOrder | undefined;

  if (params.vendorId) {
    subOrder = subOrders.find(
      (entry) => String(entry.vendorId) === params.vendorId,
    );
  } else if (params.subOrderId) {
    subOrder = subOrders.find(
      (entry) => String(entry._id) === params.subOrderId,
    );
  } else if (subOrders.length === 1) {
    // Single-vendor stores still produce exactly one sub-order, so the admin
    // UI does not have to name it.
    subOrder = subOrders[0];
  }

  if (!subOrder) throw new NotFoundError("Sub-order");

  // Carriers want a contact address on the consignee, and an order stores only
  // a customerId — so it is resolved once, here, for every carrier route.
  const customer = order.customerId
    ? await User.findById(order.customerId).select("email").lean()
    : null;

  return {
    order,
    subOrder,
    customerEmail: (customer as { email?: string } | null)?.email,
    vendorId: params.vendorId,
  };
}

/**
 * Load a shipment and prove the caller owns it.
 *
 * The order-level match is not enough on a split order: without this, vendor A
 * could void vendor B's label simply because both parcels hang off the same
 * order id.
 */
export async function loadOwnedShipment(params: {
  shipmentId: string;
  orderId: string;
  vendorId?: string;
}): Promise<IShipment> {
  const shipment = await Shipment.findOne({
    _id: params.shipmentId,
    orderId: params.orderId,
  }).lean<IShipment | null>();
  if (!shipment) throw new NotFoundError("Shipment");

  if (params.vendorId && String(shipment.vendorId || "") !== params.vendorId) {
    throw new AuthorizationError("This shipment belongs to another vendor");
  }

  return shipment;
}
