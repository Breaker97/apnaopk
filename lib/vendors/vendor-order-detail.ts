import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { isValidObjectId } from "@/lib/api/validate";
import { Order } from "@/models";
import { consignmentCharge } from "@/lib/finance/postings";
import { getFulfillmentPaymentBlock } from "@/lib/orders/fulfillment-payment-gate";
import { resolveVendorPaymentDisplayStatus } from "@/lib/orders/order-payment-status";
import { resolvePosSoldByName } from "@/lib/orders/pos-sold-by";
import { isPosWalkIn } from "@/lib/orders/pos-walk-in";
import { isPlatformSettled } from "@/lib/payments/payment-custody";
import { resolveReturnPolicy, type ReturnPolicySettingsLike } from "@/lib/returns/return-policy";
import {
  fetchRefundTotalsByOrder,
  payableInCurrency,
  sumVendorPayable,
} from "@/lib/vendors/vendor-earnings";
import type { IOrder } from "@/types";

/**
 * One order as a seller sees it: their own consignment, who it goes to, how
 * it was paid for and what it earns them. `GET /api/vendor/orders/[id]` and
 * the business app's GET /orders/{id} (a seller's workspace) both read it, so
 * the two never disagree about what a seller may see of an order.
 */

/** What of the store's settings the detail reads: the currency, and who pays a COD delivery. */
export type VendorOrderDetailSettings = ReturnPolicySettingsLike & {
  general?: { defaultCurrency?: string | null } | null;
};

/** Commission billed on a sale, less the store's own promotion on it. */
function billedAfterPromotions(totals: {
  commissionAmount: number;
  promotionCredit: number;
}): number {
  return Math.max(
    0,
    Math.round((totals.commissionAmount - totals.promotionCredit) * 100) / 100,
  );
}

type VendorOrderDocument = IOrder & { customerId?: { name?: string; email?: string } };

/**
 * Order `orderId` with the seller's consignment of it, or null when it is not
 * an order of theirs (or not an order at all). The whole document: only
 * `vendorOrderDetail` decides what of it the seller is shown.
 */
export async function findVendorOrder(
  orderId: string,
  vendorId: Types.ObjectId,
): Promise<{ order: VendorOrderDocument; subOrder: IOrder["subOrders"][number] } | null> {
  if (!isValidObjectId(orderId)) return null;

  await connectDB();
  const order = await Order.findOne({
    _id: orderId,
    "subOrders.vendorId": vendorId,
  })
    .populate("customerId", "name email")
    .lean<VendorOrderDocument>();
  const subOrder = order?.subOrders.find(
    (sub) => String(sub.vendorId) === String(vendorId),
  );

  if (!order || !subOrder) return null;
  return { order, subOrder };
}

/** The seller's view of order `orderId`, or null when it is not an order of theirs. */
export async function loadVendorOrderDetail(
  orderId: string,
  vendorId: Types.ObjectId,
  settings: VendorOrderDetailSettings,
) {
  const found = await findVendorOrder(orderId, vendorId);
  return found ? vendorOrderDetail(found, vendorId, settings) : null;
}

/** What the seller is shown of an order `findVendorOrder` found: an allow-list. */
export async function vendorOrderDetail(
  { order, subOrder }: { order: VendorOrderDocument; subOrder: IOrder["subOrders"][number] },
  vendorId: Types.ObjectId,
  settings: VendorOrderDetailSettings,
) {
  const currency = String(
    order.currency || settings.general?.defaultCurrency || "USD",
  ).toUpperCase();
  // Read together: neither waits on the other.
  const [refunds, soldByName] = await Promise.all([
    fetchRefundTotalsByOrder([order._id]),
    resolvePosSoldByName(order),
  ]);
  // The payout arithmetic, not the sub-order's face values: those are
  // undiscounted and pre-refund, so a couponed or refunded order showed the
  // vendor earnings no payout would ever pay.
  const settle = (billVendorCodShipping: boolean) =>
    payableInCurrency(
      sumVendorPayable([order], vendorId, refunds, () => true, currency, {
        billVendorCodShipping,
      }),
      currency,
    );
  const earnings = settle(false);
  const vendorCollects = !isPlatformSettled(order, subOrder);
  // A counter sale with no customer chosen is filed under its cashier: the
  // vendor is told it was a walk-in, and never gets the cashier's name or
  // email in place of a customer's.
  const posWalkIn = isPosWalkIn(order);

  // An allow-list, not the order. Spreading the document shipped every
  // vendor's lines on a split order — unit cost included — and the store's
  // payment references to whichever vendor opened it.
  return {
    _id: order._id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    paymentMethod: order.paymentMethod,
    // This vendor's own payment state. The order-level one read "Partially
    // paid" to a vendor whose share had already arrived.
    paymentStatus: resolveVendorPaymentDisplayStatus(order, subOrder),
    // Whether moving this consignment towards the shopper is refused until
    // the payment arrives (the vendor PUT) — the answer, not the payment fields.
    fulfillmentBlocked: Boolean(
      getFulfillmentPaymentBlock(
        order as Parameters<typeof getFulfillmentPaymentBlock>[0],
        subOrder as Parameters<typeof getFulfillmentPaymentBlock>[1],
      ),
    ),
    shippingAddress: order.shippingAddress,
    // Whether shipping waits on the address. Who on the staff placed or
    // released the hold stays with the store.
    addressHold: order.addressHold
      ? {
          state: order.addressHold.state,
          message: order.addressHold.message,
          placedAt: order.addressHold.placedAt,
          requestedAt: order.addressHold.requestedAt,
          requestsSent: order.addressHold.requestsSent,
          deadlineAt: order.addressHold.deadlineAt,
          expiredAt: order.addressHold.expiredAt,
          customerConfirmedAt: order.addressHold.customerConfirmedAt,
          releasedAt: order.addressHold.releasedAt,
          releaseReason: order.addressHold.releaseReason,
        }
      : undefined,
    customerId: posWalkIn ? undefined : order.customerId,
    posWalkIn,
    // Who rang a POS sale up; nothing for an online order.
    soldByName,
    // What the shopper wrote at checkout is often for whoever packs the
    // parcel ("leave with the guard", a gift message).
    customerNote: order.customerNote,
    checkoutFields: order.checkoutFields,
    subOrders: [subOrder],
    finance: {
      currency,
      // What the shopper is charged for THIS consignment — the figure a
      // courier collects at the door, and the one the ledger books as cash.
      charge: consignmentCharge({ ...order, currency }, subOrder._id),
      grossSales: earnings.grossSales,
      commission: earnings.commissionAmount,
      earnings: earnings.netAmount,
      vendorCollects,
      // What the store bills a vendor who keeps the cash: the commission,
      // plus the delivery they took at the door when the store bills it back.
      billedToVendor: vendorCollects
        ? billedAfterPromotions(
            settle(resolveReturnPolicy(settings).billVendorCodShipping),
          )
        : 0,
      // The store's own promotion on this sale, owed to a vendor who
      // collected the discounted price — already netted off the bill above.
      storePromotion: vendorCollects ? earnings.promotionCredit : 0,
    },
  };
}

export type VendorOrderDetail = Awaited<ReturnType<typeof vendorOrderDetail>>;
