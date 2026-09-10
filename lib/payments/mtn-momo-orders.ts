import { Order } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import {
  getMtnMomoTransactionState,
  mtnMomoChargeCurrency,
  type MtnMomoMode,
  type MtnMomoRequestToPayStatus,
} from "@/lib/payments/mtn-momo";
import { amountsMatchForCurrency } from "@/lib/intl/money";
import {
  amountDueNow,
  finalizeCapturedOrder,
  type SettingsDocument,
} from "@/lib/payments/finalize-order";

type FinalizeMtnMomoOrderParams = {
  /** The X-Reference-Id UUID we minted for requesttopay. */
  referenceId: string;
  /**
   * The authoritative GET requesttopay/{referenceId} response — always a
   * re-fetch by the caller, never the callback body: MTN's callback is
   * delivered once, unsigned, so it may prompt this call but can prove
   * nothing on its own.
   */
  transaction: MtnMomoRequestToPayStatus;
  mode: MtnMomoMode;
  settings: SettingsDocument;
  sessionUserId?: string;
  cartSessionId?: string;
  customerEmail?: string;
};

/** Settles the order behind a successful MTN MoMo request-to-pay. */
export function finalizeMtnMomoOrder(params: FinalizeMtnMomoOrderParams) {
  return finalizeCapturedOrder({
    provider: {
      paymentMethod: "mtn_momo",
      label: "MTN MoMo",
      recoveryGateway: "mtn_momo",
    },
    // A single lookup is enough: the reference is minted before the gateway
    // is called and written in the same `Order.create`, so there is no second
    // write for a callback to outrun (the Orange Money shape, not the ioTec
    // one).
    findOrder: (scope) =>
      Order.findOne({ ...scope, mtnMomoReferenceId: params.referenceId }),
    notFoundMessage: "Order not found for MTN MoMo transaction",
    verify: (order) => {
      // externalId was set to our own order id at request time; a status
      // response naming a different one is answering about someone else's
      // transaction.
      if (
        params.transaction.externalId &&
        String(params.transaction.externalId) !== String(order._id)
      ) {
        throw new ValidationError("MTN MoMo reference mismatch");
      }

      const transactionState = getMtnMomoTransactionState(params.transaction);
      if (transactionState !== "completed") {
        throw new ValidationError(
          `MTN MoMo transaction not completed: ${transactionState}`,
        );
      }

      const expectedAmount = amountDueNow(order);

      // Unlike Orange's /transactionstatus, the status endpoint is queried by
      // reference alone — it echoes what was collected rather than confirming
      // what we expected. So amount and currency ARE the primary gate here,
      // compared against the wire currency (sandbox settles in EUR, not the
      // store currency), at that currency's own precision.
      const chargeCurrency = mtnMomoChargeCurrency(
        params.mode,
        order.currency || params.settings.general?.defaultCurrency,
      );
      const reportedCurrency = String(
        params.transaction.currency || "",
      ).toUpperCase();
      if (reportedCurrency && reportedCurrency !== chargeCurrency) {
        throw new ValidationError("MTN MoMo currency mismatch");
      }
      const reportedAmount = Number(params.transaction.amount);
      if (
        params.transaction.amount !== undefined &&
        Number.isFinite(reportedAmount) &&
        !amountsMatchForCurrency(expectedAmount, reportedAmount, chargeCurrency)
      ) {
        throw new ValidationError("MTN MoMo amount mismatch");
      }

      const financialTransactionId = String(
        params.transaction.financialTransactionId || "",
      ).trim();
      return {
        paymentId: financialTransactionId || params.referenceId,
        paymentUpdate: financialTransactionId
          ? { mtnMomoTransactionId: financialTransactionId }
          : {},
        auditTransactionId: financialTransactionId || null,
      };
    },
    settings: params.settings,
    sessionUserId: params.sessionUserId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
  });
}
