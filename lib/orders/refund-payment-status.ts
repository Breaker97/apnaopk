import { Order } from "@/models/order.model";
import { PAYMENT_STATUS } from "@/config/app.config";

/**
 * Put an order whose running refund total has reached what it collected on
 * `refunded`.
 *
 * Every refund path works the payment status out from its own claim on
 * `refundedTotal` and writes it. Two refunds landing together each did, and
 * whichever wrote last won: an order refunded in full — 60 and 40 of 100 —
 * could be left reading "partially refunded" for good. Asked of the STORED
 * total after the write, this settles it whichever of the two finished last.
 *
 * `ceiling` is what the order could be refunded — its total, or less where
 * part of it was never collected (`getOrderRefundCeiling`). Returns whether
 * the status moved.
 */
export async function settleRefundedPaymentStatus(params: {
  orderId: unknown;
  ceiling: number;
}): Promise<boolean> {
  const ceiling = Number(params.ceiling);
  if (!Number.isFinite(ceiling) || ceiling <= 0) return false;
  try {
    const result = await Order.updateOne(
      {
        _id: params.orderId,
        paymentStatus: PAYMENT_STATUS.PARTIALLY_REFUNDED,
        $expr: {
          $gte: [{ $ifNull: ["$refundedTotal", 0] }, ceiling - 0.01],
        },
      },
      { $set: { paymentStatus: PAYMENT_STATUS.REFUNDED } },
    );
    return Number(result?.modifiedCount || 0) > 0;
  } catch (error) {
    console.error("Failed to settle a refunded order's payment status:", error);
    return false;
  }
}
