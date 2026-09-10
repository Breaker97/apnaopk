import { Order } from "@/models";
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

/**
 * Undoes a capture Pesapal has since reversed (chargeback or merchant reversal).
 * Without this an order stays PAID after the money is clawed back, so the
 * payment is written off, the order cancelled, stock handed back and the coupon
 * use released. Idempotent: the paid-status guard in the update means only the
 * first call for an order does any work.
 */
export async function reversePesapalOrder(params: {
  orderTrackingId: string;
  settings: SettingsDocument;
}) {
  const order = await Order.findOneAndUpdate(
    {
      pesapalOrderTrackingId: params.orderTrackingId,
      paymentMethod: "pesapal",
      paymentStatus: {
        $in: [PAYMENT_STATUS.PAID, PAYMENT_STATUS.PARTIALLY_PAID],
      },
    },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.REFUNDED,
        status: ORDER_STATUS.CANCELLED,
      },
    },
    { new: true },
  );

  // Never captured, or already reversed — nothing to undo.
  if (!order) return { reversed: false };

  const capturedAmount = Math.max(
    0,
    Number(order.total || 0) - Number(order.preorderOutstandingAmount || 0),
  );

  // Consume the refund headroom the admin refund flow checks against, so the
  // reversed amount cannot be refunded a second time by hand.
  await Order.updateOne(
    { _id: order._id, refundedTotal: { $lt: capturedAmount } },
    { $set: { refundedTotal: capturedAmount } },
  ).catch((err) =>
    console.error("Failed to record refunded total on Pesapal reversal:", err),
  );

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

  await createRefundTransaction({
    order: {
      _id: String(order._id),
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
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
    amount: capturedAmount,
    reason: "Pesapal transaction reversed",
    // Pesapal reversed it on their side; we are recording, not requesting.
    gatewayCalled: false,
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

  return {
    reversed: true,
    orderId: String(order._id),
    orderNumber: order.orderNumber,
  };
}
