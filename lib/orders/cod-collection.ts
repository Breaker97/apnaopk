import { Order } from "@/models/order.model";
import { getSettings } from "@/models/settings.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import {
  isPlatformCollectedCod,
  type CodCustodySubOrder,
} from "@/lib/payments/cod-collection";

/**
 * Whether a vendor saying "delivered" may settle this order's cash: only when
 * the vendors collected it themselves. Where the store's courier collects
 * (`isPlatformCollectedCod`), the money is the platform's to confirm — the
 * carrier's delivery event, or an admin — or a vendor could mark a parcel
 * delivered and be paid out of cash nobody took.
 */
export function vendorDeliverySettlesCod(order: {
  subOrders?: Array<(CodCustodySubOrder & { status?: string | null }) | null> | null;
}): boolean {
  return !(order.subOrders ?? []).some(
    (subOrder) =>
      subOrder?.status !== ORDER_STATUS.CANCELLED && isPlatformCollectedCod(subOrder),
  );
}

/**
 * Cash on delivery, recorded at delivery.
 *
 * A COD order is `pending` from the moment it is placed until somebody says
 * the money arrived, and nothing ever said it: no gateway webhook is coming,
 * and marking it paid by hand is a second action a busy shop forgets. So the
 * store ended up with two answers to "what did we take?" — the dashboard and
 * the analytics page counted a delivered COD order as revenue (that is what
 * the `delivered` arm of `COLLECTED_ORDER_MATCH` is for), while the ledger,
 * and therefore Finance, had never heard of it: no charge row, no entries, no
 * vendor payable. On a COD-heavy store that gap is most of the business.
 *
 * Delivery is the event that settles it. The courier handed the goods over and
 * took the cash; that is the whole transaction, and it is the only moment
 * there will ever be. So the order is marked paid here, which puts it through
 * the same door every other payment goes through — `ensureChargeTransaction`
 * writes the charge row and posts the ledger from it — and both screens start
 * reading the same sale.
 *
 * Three guards, and each one is a case where delivery does NOT mean paid:
 *
 *  - **The whole order, not one parcel.** A charge row carries the order total
 *    and cannot be apportioned, so on a split order this waits until the last
 *    consignment is delivered — which is exactly when the order itself becomes
 *    `delivered`. The vendor route already refuses to write a charge row on a
 *    partial collection for the same reason.
 *  - **Only `pending`.** An order already paid, part-paid or refunded has its
 *    money accounted for; this must never overwrite that.
 *  - **Never a pre-order with a balance still owed.** That money is recorded
 *    from the pre-order screen, which checks it against what is owed
 *    (`assertManualPaymentStatusChange` refuses it by hand for the same
 *    reason).
 *
 * Claim-based and idempotent: the guard is part of the update, so the admin
 * route, the vendor route and a carrier webhook can all call it for the same
 * delivery and only the first one does anything.
 *
 * Never throws. The delivery has already been saved and is the thing the
 * person was doing; a bookkeeping step that failed is reconcilable, and the
 * daily ledger scan re-posts from the order anyway.
 */

/** The methods whose money changes hands at the door. */
const DOOR_PAYMENT_METHODS = ["cod", "cash_on_delivery"];

export async function settleCodOnDelivery(orderId: unknown): Promise<boolean> {
  try {
    const now = new Date();
    const claimed = await Order.findOneAndUpdate(
      {
        _id: orderId,
        paymentMethod: { $in: DOOR_PAYMENT_METHODS },
        paymentStatus: PAYMENT_STATUS.PENDING,
        status: ORDER_STATUS.DELIVERED,
        $or: [
          { preorderOutstandingAmount: { $exists: false } },
          { preorderOutstandingAmount: { $lte: 0 } },
        ],
      },
      {
        $set: {
          paymentStatus: PAYMENT_STATUS.PAID,
          // The consignments move with the order, as they do on every other
          // payment path: a paid order whose sub-orders still read `pending`
          // shows the vendor an unpaid sale and keeps the fulfilment gate shut.
          // Cancelled ones are left alone — nobody collected for those.
          "subOrders.$[live].paymentStatus": PAYMENT_STATUS.PAID,
          "subOrders.$[live].paidAt": now,
        },
        // The day the money arrived, which is what the ledger dates the sale
        // by. `$min` so an order that somehow already carries an earlier one
        // keeps it.
        $min: { paidAt: now },
      },
      {
        returnDocument: "after",
        arrayFilters: [{ "live.status": { $ne: ORDER_STATUS.CANCELLED } }],
      },
    );
    if (!claimed) return false;

    const settings = await getSettings();
    // The store credit that paid the rest is spent with it (R8) — before the
    // charge row, whose ledger posting reads what the credit paid.
    const { settleOrderStoreCredit } = await import("@/lib/store-credit/store-credit");
    await settleOrderStoreCredit(
      claimed as Parameters<typeof settleOrderStoreCredit>[0],
    ).catch((err) =>
      console.error("Failed to settle store credit on COD delivery:", err),
    );
    const { ensureChargeTransaction } = await import(
      "@/lib/payments/payment-transactions"
    );
    // The one door. It turns the pending charge row COD checkout wrote into a
    // succeeded one, posts the ledger off the order, and tells the admins the
    // money came in — the same three things a gateway capture causes.
    await ensureChargeTransaction({
      _id: String(claimed._id),
      orderNumber: claimed.orderNumber,
      paymentMethod: claimed.paymentMethod,
      paymentStatus: claimed.paymentStatus,
      paymentId: claimed.paymentId,
      subtotal: claimed.subtotal,
      shippingCost: claimed.shippingCost,
      tax: claimed.tax,
      discount: claimed.discount,
      total: claimed.total,
      currency: claimed.currency || settings.general?.defaultCurrency,
      channel: claimed.channel || "online",
      createdAt: claimed.createdAt,
    }).catch((err) =>
      console.error(
        `Failed to record the charge for delivered COD order ${claimed.orderNumber}:`,
        err,
      ),
    );


    const { awardOrderLoyaltyPoints, refreshCustomerStatsForOrder } =
      await import("@/lib/customers/customer");
    // Both are gated on the order being paid, so until now a COD shopper
    // earned no points and their lifetime spend never counted the sale.
    await awardOrderLoyaltyPoints(String(claimed._id)).catch((err) =>
      console.error("Failed to award loyalty points on COD delivery:", err),
    );
    await refreshCustomerStatsForOrder(claimed).catch((err) =>
      console.error("Failed to refresh customer stats on COD delivery:", err),
    );

    return true;
  } catch (error) {
    console.error(
      `Failed to settle cash on delivery for order ${String(orderId)}:`,
      error,
    );
    return false;
  }
}
