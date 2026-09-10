import { Order } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import {
  getIotecTransactionState,
  type IotecTransactionStatus,
} from "@/lib/payments/iotec";
import {
  amountDueNow,
  finalizeCapturedOrder,
  type SettingsDocument,
} from "@/lib/payments/finalize-order";

type FinalizeIotecOrderParams = {
  transactionId: string;
  externalId?: string;
  transaction: IotecTransactionStatus;
  settings: SettingsDocument;
  sessionUserId?: string;
  cartSessionId?: string;
  customerEmail?: string;
};

/** Settles the order behind a completed ioTec collection. */
export function finalizeIotecOrder(params: FinalizeIotecOrderParams) {
  return finalizeCapturedOrder({
    provider: {
      paymentMethod: "iotec",
      label: "ioTec",
      recoveryGateway: "iotec",
    },
    // Checkout writes the transaction id right after the collection is
    // accepted, so a callback can land in the gap between the two. The
    // external id is stored before the collection is submitted and covers
    // that window.
    findOrder: async (scope) => {
      const byTransaction = await Order.findOne({
        ...scope,
        iotecTransactionId: params.transactionId,
      });
      if (byTransaction || !params.externalId) return byTransaction;
      return Order.findOne({ ...scope, iotecExternalId: params.externalId });
    },
    notFoundMessage: "Order not found for ioTec transaction",
    assertReference: (order) => {
      if (
        order.iotecTransactionId &&
        order.iotecTransactionId !== params.transactionId
      ) {
        throw new ValidationError("ioTec reference mismatch");
      }
    },
    verify: (order) => {
      if (
        params.externalId &&
        order.iotecExternalId &&
        params.externalId !== order.iotecExternalId
      ) {
        throw new ValidationError("ioTec reference mismatch");
      }

      const transactionState = getIotecTransactionState(params.transaction);
      if (transactionState !== "completed") {
        throw new ValidationError(
          `ioTec transaction not completed: ${transactionState}`,
        );
      }

      // Prefer the currency snapshotted on the order at checkout; a missing
      // currency on the ioTec status response is rejected, mirroring the other
      // gateway finalizers (a silent skip would accept a mis-denominated charge).
      const expectedCurrency = (
        order.currency ||
        params.settings.general?.defaultCurrency ||
        "UGX"
      ).toUpperCase();
      const transactionCurrency = String(
        params.transaction.currency || "",
      ).toUpperCase();
      if (transactionCurrency !== expectedCurrency) {
        throw new ValidationError("ioTec currency mismatch");
      }

      // UGX is a zero-decimal currency; compare rounded whole units. A missing
      // amount casts to NaN and fails the comparison, so it is rejected too.
      if (
        Math.round(Number(params.transaction.amount)) !==
        Math.round(amountDueNow(order))
      ) {
        throw new ValidationError("ioTec amount mismatch");
      }

      return {
        paymentId: params.transactionId,
        // Backfill when the order was matched on its external id alone.
        paymentUpdate: { iotecTransactionId: params.transactionId },
      };
    },
    settings: params.settings,
    sessionUserId: params.sessionUserId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
  });
}
