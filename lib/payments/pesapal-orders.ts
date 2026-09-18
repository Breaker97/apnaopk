import { Order, PaymentTransaction } from "@/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import {
  restoreOrderInventory,
} from "@/lib/orders/order-inventory";
import {
  getOrderPreorderLines,
  releasePreorderQuantity,
} from "@/lib/orders/preorders";
import { createRefundTransaction } from "@/lib/payments/payment-transactions";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { ValidationError } from "@/lib/api/errors";
import {
  getPesapalTransactionState,
  type PesapalTransactionStatus,
} from "@/lib/payments/pesapal";
import {
  amountDueNow,
  finalizeCapturedOrder,
  type SettingsDocument,
} from "@/lib/payments/finalize-order";

type FinalizePesapalOrderParams = {
  orderTrackingId: string;
  merchantReference?: string;
  transaction: PesapalTransactionStatus;
  settings: SettingsDocument;
  sessionUserId?: string;
  cartSessionId?: string;
  customerEmail?: string;
};

/** Settles the order behind a completed Pesapal transaction. */
export function finalizePesapalOrder(params: FinalizePesapalOrderParams) {
  return finalizeCapturedOrder({
    provider: {
      paymentMethod: "pesapal",
      label: "Pesapal",
      recoveryGateway: "pesapal",
    },
    findOrder: (scope) =>
      Order.findOne({
        ...scope,
        pesapalOrderTrackingId: params.orderTrackingId,
      }),
    notFoundMessage: "Order not found for Pesapal transaction",
    verify: (order) => {
      const transactionReference = String(
        params.transaction.merchant_reference || "",
      );
      if (
        transactionReference !== order.pesapalMerchantReference ||
        (params.merchantReference &&
          params.merchantReference !== order.pesapalMerchantReference)
      ) {
        throw new ValidationError("Pesapal merchant reference mismatch");
      }

      const transactionState = getPesapalTransactionState(params.transaction);
      if (transactionState !== "completed") {
        throw new ValidationError(
          `Pesapal transaction not completed: ${transactionState}`,
        );
      }

      // Compare against the currency snapshotted on the order at checkout, not
      // the store's current default — changing the default currency after
      // checkout must not strand in-flight payments with a "currency mismatch".
      const expectedCurrency = (
        order.currency ||
        params.settings.general?.defaultCurrency ||
        "UGX"
      ).toUpperCase();
      const transactionCurrency = String(
        params.transaction.currency || "",
      ).toUpperCase();
      if (transactionCurrency !== expectedCurrency) {
        throw new ValidationError("Pesapal currency mismatch");
      }

      const expectedAmount = amountDueNow(order);
      if (
        Math.round(Number(params.transaction.amount) * 100) !==
        Math.round(expectedAmount * 100)
      ) {
        throw new ValidationError("Pesapal amount mismatch");
      }

      const confirmationCode = String(
        params.transaction.confirmation_code || "",
      ).trim();
      return {
        paymentId: confirmationCode || params.orderTrackingId,
        paymentUpdate: confirmationCode
          ? { pesapalConfirmationCode: confirmationCode }
          : {},
        auditTransactionId: confirmationCode || null,
      };
    },
    settings: params.settings,
    sessionUserId: params.sessionUserId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
  });
}

const PAID_STATES = [PAYMENT_STATUS.PAID, PAYMENT_STATUS.PARTIALLY_PAID];

/** No balance has been recorded as paid on the order. */
const BALANCE_UNPAID = {
  $or: [
    { preorderBalancePaidAt: null },
    { preorderBalancePaidAt: { $exists: false } },
  ],
};

/**
 * Undoes a capture Pesapal has since reversed (chargeback or merchant reversal).
 * Without this an order stays PAID after the money is clawed back, so the
 * payment is written off, the order cancelled, stock handed back and the coupon
 * use released. Idempotent: the paid-status guard in the update means only the
 * first call for an order does any work.
 *
 * **What Pesapal takes back is what Pesapal took** — and on a deposit
 * pre-order that is only the deposit. Two legacy orders got that wrong. A
 * Pesapal deposit order predates the rule that a balance can only be collected
 * by card (`lib/payments/deferred-balance.ts`), and its balance could still be
 * settled afterwards, by card from the shopper's order page or recorded offline
 * by an admin:
 *
 *  - Paid by card, the settle path used to stamp the order `card`
 *    (`settlePreorderBalanceFromIntent`, since narrowed to pay-later orders),
 *    so matching the reversal on `paymentMethod: "pesapal"` found nothing and
 *    Pesapal's clawback of the deposit was never recorded at all. Orders
 *    stamped before that fix are still in the database, so the order is found
 *    by its Pesapal tracking id instead, which only a Pesapal capture has.
 *  - Either way, the reversal marked the WHOLE order refunded and cancelled it
 *    — restocking goods that had already been released, since a paid balance
 *    is what releases a pre-order — while the balance was still held. Now such
 *    an order is marked partly refunded and left standing, and an admin is told
 *    what is still held, because whether to return it or contest the reversal
 *    is a decision about a dispute, not arithmetic.
 */
/**
 * One attempt at claiming a reversal, on whichever arm the order is on now.
 *
 * The balance state is read and then claimed ON, in the same filter, so a
 * balance paid between the two cannot send the order down the wrong arm — the
 * claim simply misses, and the caller tries again.
 */
async function claimPesapalReversal(orderTrackingId: string) {
  const current = await Order.findOne({
    pesapalOrderTrackingId: orderTrackingId,
    paymentStatus: { $in: PAID_STATES },
  })
    .select("_id preorderBalancePaidAt")
    .lean<{ _id: unknown; preorderBalancePaidAt?: Date | null } | null>();
  // Never captured, or already reversed — nothing to undo.
  if (!current) return null;

  const balancePaidElsewhere = Boolean(current.preorderBalancePaidAt);
  const order = await Order.findOneAndUpdate(
    balancePaidElsewhere
      ? {
          _id: current._id,
          paymentStatus: { $in: PAID_STATES },
          preorderBalancePaidAt: { $ne: null },
        }
      : {
          _id: current._id,
          paymentStatus: { $in: PAID_STATES },
          ...BALANCE_UNPAID,
        },
    {
      $set: balancePaidElsewhere
        ? { paymentStatus: PAYMENT_STATUS.PARTIALLY_REFUNDED }
        : {
            paymentStatus: PAYMENT_STATUS.REFUNDED,
            status: ORDER_STATUS.CANCELLED,
          },
    },
    { returnDocument: "after" },
  );
  return { order, balancePaidElsewhere };
}

export async function reversePesapalOrder(params: {
  orderTrackingId: string;
  settings: SettingsDocument;
}) {
  // A second go when the first claim missed because the balance state moved
  // underneath it: the IPN route ignores what this returns, so a reversal that
  // lost that race would otherwise be dropped for good.
  let claim = await claimPesapalReversal(params.orderTrackingId);
  if (claim && !claim.order) {
    claim = await claimPesapalReversal(params.orderTrackingId);
  }
  if (!claim?.order) return { reversed: false };
  const { order, balancePaidElsewhere } = claim;

  // The deposit on a pre-order, the whole charge on anything else. Nothing a
  // balance payment added is in it, however that balance was paid.
  const capturedAmount = Math.max(
    0,
    Number(order.total || 0) - Number(order.preorderOutstandingAmount || 0),
  );

  // What Storify already recorded giving back — a refund requested from the
  // admin screen that this reversal is Pesapal carrying out. Recording the
  // whole captured amount again on top of it counted that money twice.
  const [refundSummary] = await PaymentTransaction.aggregate([
    { $match: { orderId: order._id, type: "refund", status: "succeeded" } },
    { $group: { _id: null, total: { $sum: "$grossAmount" } } },
  ]);
  const reversalAmount = Math.max(
    0,
    Number((capturedAmount - Number(refundSummary?.total || 0)).toFixed(2)),
  );

  // Consume the refund headroom the admin refund flow checks against, so the
  // reversed amount cannot be refunded a second time by hand.
  await Order.updateOne(
    { _id: order._id, refundedTotal: { $lt: capturedAmount } },
    { $set: { refundedTotal: capturedAmount } },
  ).catch((err) =>
    console.error("Failed to record refunded total on Pesapal reversal:", err),
  );

  // Only an order that is actually being cancelled gives its goods back. One
  // whose balance was paid has been released for fulfilment on that payment,
  // and may already be on its way to the shopper.
  if (!balancePaidElsewhere) {
    if (order.hasPreorder) {
      await releasePreorderQuantity(getOrderPreorderLines(order.items)).catch(
        (err) =>
          console.error(
            "Failed to release preorder quantity on Pesapal reversal:",
            err,
          ),
      );
    } else {
      await restoreOrderInventory(String(order._id)).catch((err) =>
        console.error("Failed to restore inventory on Pesapal reversal:", err),
      );
    }

    await reverseCouponUsageForOrder(String(order._id)).catch((err) =>
      console.error("Failed to reverse coupon usage on Pesapal reversal:", err),
    );
  }

  // A deposit pre-order cancelled by the reversal will never have its balance
  // paid: that part of the sale comes off the books against what the shopper
  // owed, not out of cash nobody handed over.
  if (!balancePaidElsewhere) {
    const { postBalanceWriteOffSafely } = await import("@/lib/finance/post-events");
    postBalanceWriteOffSafely(order._id);
  }

  if (reversalAmount > 0) await createRefundTransaction({
    order: {
      _id: String(order._id),
      orderNumber: order.orderNumber,
      // The reversal is Pesapal's, whatever the order has been stamped since:
      // recorded under the card method it would be filed against Stripe.
      paymentMethod: "pesapal",
      paymentStatus: order.paymentStatus,
      paymentId: order.paymentId,
      pesapalConfirmationCode: order.pesapalConfirmationCode,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      tax: order.tax,
      discount: order.discount,
      total: order.total,
      currency: order.currency || params.settings.general?.defaultCurrency,
      channel: order.channel || "online",
      createdAt: order.createdAt,
    },
    amount: reversalAmount,
    reason: "Pesapal transaction reversed",
    // Pesapal reversed it on their side; we are recording, not requesting.
    gatewayCalled: false,
    settlement: "not_required",
  }).catch((err) =>
    console.error("Failed to record Pesapal reversal transaction:", err),
  );

  const { refreshCustomerStatsForOrder, reverseOrderLoyaltyPoints } = await import(
    "@/lib/customers/customer"
  );
  await reverseOrderLoyaltyPoints(String(order._id)).catch((err) =>
    console.error("Failed to reverse loyalty points:", err),
  );
  refreshCustomerStatsForOrder(order)
    .catch((err) => console.error("Failed to refresh customer stats:", err));

  if (balancePaidElsewhere) {
    const currency = String(
      order.currency || params.settings.general?.defaultCurrency || "",
    ).toUpperCase();
    const held = Math.max(0, Number(order.total || 0) - capturedAmount);
    const { notifyAdminsPaymentAnomaly } = await import(
      "@/lib/notifications/notifications"
    );
    await notifyAdminsPaymentAnomaly({
      title: "Pesapal reversed a pre-order deposit whose balance is paid",
      message: `Pesapal took back the ${capturedAmount} ${currency} deposit on order #${order.orderNumber}, but the ${held} ${currency} balance was paid separately and is still held. The order was marked partly refunded and not cancelled, because a paid pre-order may already be on its way. Decide whether to refund the balance to the shopper or contest the reversal with Pesapal.`,
    }).catch((err) =>
      console.error("Failed to report a Pesapal deposit reversal:", err),
    );
  }

  return {
    reversed: true,
    orderId: String(order._id),
    orderNumber: order.orderNumber,
  };
}
