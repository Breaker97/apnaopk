import "server-only";

import { Types } from "mongoose";
import { Order } from "@/models";
import { Shipment } from "@/models/shipment.model";
import { isConsignmentCollected, type PostingOrder } from "@/lib/finance/postings";
import { isPlatformSettled } from "@/lib/payments/payment-custody";
import { resolveDefaultVendorId } from "@/lib/vendors/multi-vendor";
import { SHIPPING_REVENUE_TO } from "@/lib/shipping/shipping-revenue";

/**
 * A label on the store's own carrier account, for a parcel the vendor was
 * going to earn delivery on.
 *
 * The delivery charge belongs to whoever pays to deliver
 * (`lib/shipping/shipping-revenue.ts`). Checkout decides that from who
 * delivers, but a store can still buy the label on its own account for a
 * vendor's parcel — and then the store is paying for delivery, so the store
 * keeps the charge, and the vendor neither earns it nor pays for the label.
 *
 * Only while no payout has claimed the consignment: once a payout has frozen
 * what the vendor is owed, a label bought afterwards does not take delivery
 * money back out of it, and the store simply bears that label.
 *
 * Only where the store holds the money and it has arrived: the sale posted the
 * charge to the vendor's payable, and this moves exactly that. A vendor who
 * collected the cash themselves kept the charge in hand, and nothing here
 * reaches into it.
 */

type ShipmentLike = {
  _id: unknown;
  orderId?: unknown;
  subOrderId?: unknown;
  bookingSequence?: number | null;
  purchase?: { billedTo?: string | null; shippingToStore?: boolean | null } | null;
};

const ORDER_FIELDS =
  "orderNumber currency total tax shippingCost discount coupon.type customs.dutyAmount paymentMethod paymentStatus preorderOutstandingAmount channel stripePaymentIntentId subOrders._id subOrders.vendorId subOrders.status subOrders.paymentStatus subOrders.codCollectedBy subOrders.fulfillment.method subOrders.shippingRevenueTo subOrders.platformLabelAt subOrders.payoutStatus";

export async function moveShippingToStoreForLabel(
  shipment: ShipmentLike,
): Promise<boolean> {
  if (String(shipment.purchase?.billedTo || "platform") === "vendor") return false;
  if (!shipment.orderId || !shipment.subOrderId) return false;

  const order = await Order.findById(shipment.orderId)
    .select(ORDER_FIELDS)
    .lean<(PostingOrder & { subOrders?: Array<Record<string, unknown>> }) | null>();
  const sub = order?.subOrders?.find(
    (entry) => String(entry._id) === String(shipment.subOrderId),
  );
  if (!order || !sub) return false;
  if (String(sub.shippingRevenueTo || "") !== SHIPPING_REVENUE_TO.VENDOR) return false;

  // The store's own sale already keeps its delivery.
  const defaultVendorId = await resolveDefaultVendorId().catch(() => null);
  if (defaultVendorId && String(defaultVendorId) === String(sub.vendorId)) return false;

  const custody = {
    paymentMethod: order.paymentMethod,
    channel: order.channel,
    stripePaymentIntentId: order.stripePaymentIntentId,
  };
  if (!isConsignmentCollected(order, sub)) return false;

  // The vendor took the shopper's money at the door and the store's courier
  // carried the parcel: there is no payable to move the charge out of, so the
  // store bills them for the delivery it paid to make, alongside the
  // commission they already owe. Only where the store says to — it depends on
  // who arranged the carrier, and a store that arranges it as a service to
  // its sellers charges nothing.
  const billToVendor = !isPlatformSettled(custody, sub);
  if (billToVendor) {
    const { resolveReturnPolicy } = await import("@/lib/returns/return-policy");
    const { getSettings } = await import("@/models/settings.model");
    if (!resolveReturnPolicy(await getSettings()).billVendorCodShipping) {
      return false;
    }
  }

  const stamped = await Order.updateOne(
    {
      _id: order._id,
      subOrders: {
        $elemMatch: {
          _id: new Types.ObjectId(String(shipment.subOrderId)),
          shippingRevenueTo: SHIPPING_REVENUE_TO.VENDOR,
          platformLabelAt: null,
          payoutStatus: { $nin: ["scheduled", "paid"] },
        },
      },
    },
    { $set: { "subOrders.$.platformLabelAt": new Date() } },
  );
  if (!stamped.modifiedCount) return false;

  await Shipment.updateOne(
    { _id: shipment._id },
    { $set: { "purchase.shippingToStore": true } },
  );
  const { postShippingToStore } = await import("@/lib/finance/post-events");
  await postShippingToStore({
    orderId: order._id,
    subOrderId: shipment.subOrderId,
    shipmentId: shipment._id,
    bookingSequence: shipment.bookingSequence,
    billToVendor,
  });
  return true;
}

/**
 * The store's label was voided and the carrier refunded it: the store is no
 * longer paying to deliver, so the vendor earns the charge again — unless a
 * payout has claimed the consignment meanwhile, in which case it was paid out
 * without delivery and stays that way.
 *
 * `shipment` is the document as it was BEFORE the void, whose booking number
 * the charge was moved under.
 */
export async function returnShippingForVoidedLabel(
  shipment: ShipmentLike,
): Promise<boolean> {
  if (!shipment.purchase?.shippingToStore) return false;
  if (!shipment.orderId || !shipment.subOrderId) return false;

  // Which way the charge moved when the label was bought decides which way it
  // moves back: out of the seller's payable, or off their bill.
  const billed = await Order.findById(shipment.orderId)
    .select(ORDER_FIELDS)
    .lean<(PostingOrder & { subOrders?: Array<Record<string, unknown>> }) | null>();
  const billedSub = billed?.subOrders?.find(
    (entry) => String(entry._id) === String(shipment.subOrderId),
  );
  const billToVendor = Boolean(
    billed &&
      billedSub &&
      !isPlatformSettled(
        {
          paymentMethod: billed.paymentMethod,
          channel: billed.channel,
          stripePaymentIntentId: billed.stripePaymentIntentId,
        },
        billedSub,
      ),
  );

  const cleared = await Order.updateOne(
    {
      _id: shipment.orderId,
      subOrders: {
        $elemMatch: {
          _id: new Types.ObjectId(String(shipment.subOrderId)),
          platformLabelAt: { $ne: null },
          payoutStatus: { $nin: ["scheduled", "paid"] },
        },
      },
    },
    { $unset: { "subOrders.$.platformLabelAt": "" } },
  );

  await Shipment.updateOne(
    { _id: shipment._id },
    { $unset: { "purchase.shippingToStore": "" } },
  );
  if (!cleared.modifiedCount) return false;

  const { postShippingToStore } = await import("@/lib/finance/post-events");
  await postShippingToStore({
    orderId: shipment.orderId,
    subOrderId: shipment.subOrderId,
    shipmentId: shipment._id,
    bookingSequence: shipment.bookingSequence,
    reversal: true,
    billToVendor,
  });
  return true;
}
