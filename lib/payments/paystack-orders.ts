import { Order } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import {
  toPaystackAmountSubunits,
  type PaystackTransaction,
} from "@/lib/payments/paystack";
import { gatewayFeeUpdate, paystackFee } from "@/lib/payments/gateway-fee";
import {
  amountDueNow,
  finalizeCapturedOrder,
  type SettingsDocument,
} from "@/lib/payments/finalize-order";

type FinalizePaystackOrderParams = {
  reference: string;
  transaction: PaystackTransaction;
  settings: SettingsDocument;
  sessionUserId?: string;
  cartSessionId?: string;
  customerEmail?: string;
};

/** Settles the order behind a verified Paystack transaction. */
export function finalizePaystackOrder(params: FinalizePaystackOrderParams) {
  return finalizeCapturedOrder({
    provider: {
      paymentMethod: "paystack",
      label: "Paystack",
      recoveryGateway: "paystack",
    },
    findOrder: (scope) =>
      Order.findOne({ ...scope, paystackReference: params.reference }),
    notFoundMessage: "Order not found for Paystack transaction",
    verify: (order) => {
      if (params.transaction.reference !== params.reference) {
        throw new ValidationError("Paystack reference mismatch");
      }

      if (params.transaction.status !== "success") {
        throw new ValidationError(
          `Paystack transaction not successful: ${params.transaction.status}`,
        );
      }

      const expectedCurrency = (
        params.settings.general?.defaultCurrency || "NGN"
      ).toUpperCase();
      const transactionCurrency = String(
        params.transaction.currency || "",
      ).toUpperCase();
      if (transactionCurrency !== expectedCurrency) {
        throw new ValidationError("Paystack currency mismatch");
      }

      const expectedAmount = toPaystackAmountSubunits(
        amountDueNow(order),
        expectedCurrency,
      );
      if (Number(params.transaction.amount) !== expectedAmount) {
        throw new ValidationError("Paystack amount mismatch");
      }

      const transactionId = String(params.transaction.id);
      return {
        paymentId: transactionId,
        paymentUpdate: {
          paystackTransactionId: transactionId,
          // Paystack reports its cut on the verified transaction, in subunits.
          // Captured here because this is the only moment it is in hand — the
          // status API does not repeat it once the row is settled.
          ...gatewayFeeUpdate(paystackFee(params.transaction)),
        },
        customerEmail: params.transaction.customer?.email || undefined,
      };
    },
    settings: params.settings,
    sessionUserId: params.sessionUserId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
  });
}
