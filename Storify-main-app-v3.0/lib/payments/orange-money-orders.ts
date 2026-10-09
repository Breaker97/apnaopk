import { Order } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import {
  getOrangeMoneyTransactionState,
  orangeMoneyChargeCurrency,
  type OrangeMoneyMode,
  type OrangeMoneyTransactionStatus,
} from "@/lib/payments/orange-money";
import {
  amountDueNow,
  finalizeCapturedOrder,
  type SettingsDocument,
} from "@/lib/payments/finalize-order";

type FinalizeOrangeMoneyOrderParams = {
  /** Our own reference, which is what Orange calls `order_id`. */
  orderId: string;
  /** The authoritative `/transactionstatus` response. */
  transaction: OrangeMoneyTransactionStatus;
  /**
   * The raw notification body, when one prompted this call. Orange's status
   * response carries no amount or currency, so the notification is the only
   * place either appears — and it is untrusted, hence a cross-check rather
   * than a source of truth.
   */
  notification?: OrangeMoneyTransactionStatus;
  mode: OrangeMoneyMode;
  settings: SettingsDocument;
  sessionUserId?: string;
  cartSessionId?: string;
  customerEmail?: string;
};

/** Settles the order behind a successful Orange Money web payment. */
export function finalizeOrangeMoneyOrder(
  params: FinalizeOrangeMoneyOrderParams,
) {
  return finalizeCapturedOrder({
    provider: {
      paymentMethod: "orange_money",
      label: "Orange Money",
      recoveryGateway: "orange_money",
    },
    // A single lookup is enough: unlike ioTec, the reference is minted before
    // the gateway is called and written in the same `Order.create` as the
    // tokens, so there is no second write for a notification to outrun.
    findOrder: (scope) =>
      Order.findOne({ ...scope, orangeMoneyOrderId: params.orderId }),
    notFoundMessage: "Order not found for Orange Money transaction",
    verify: (order) => {
      if (
        params.transaction.order_id &&
        String(params.transaction.order_id) !== params.orderId
      ) {
        throw new ValidationError("Orange Money reference mismatch");
      }

      const transactionState = getOrangeMoneyTransactionState(
        params.transaction,
      );
      if (transactionState !== "completed") {
        throw new ValidationError(
          `Orange Money transaction not completed: ${transactionState}`,
        );
      }

      const expectedAmount = amountDueNow(order);

      // `/transactionstatus` is queried with OUR order id, OUR pay token and
      // OUR expected amount, so a SUCCESS answer already confirms the amount —
      // Orange will not report success for a transaction of a different
      // value. That is why the checks below are cross-checks on the
      // notification rather than the primary amount gate the other gateways
      // need.
      if (params.notification) {
        // The wire currency, not the order's: sandbox settles in Orange's fake
        // OUV and echoes it back, so comparing against `order.currency` would
        // reject every sandbox payment as a mismatch.
        const expectedCurrency = orangeMoneyChargeCurrency(
          params.mode,
          order.currency || params.settings.general?.defaultCurrency,
        );
        const notifiedCurrency = String(
          params.notification.currency || "",
        ).toUpperCase();
        if (notifiedCurrency && notifiedCurrency !== expectedCurrency) {
          throw new ValidationError("Orange Money currency mismatch");
        }

        // Absent is tolerated (Orange does not document the field as
        // mandatory); present and wrong is not.
        const notifiedAmount = Number(params.notification.amount);
        if (
          params.notification.amount !== undefined &&
          Number.isFinite(notifiedAmount) &&
          Math.round(notifiedAmount * 100) !== Math.round(expectedAmount * 100)
        ) {
          throw new ValidationError("Orange Money amount mismatch");
        }
      }

      const txnId = params.transaction.txnid
        ? String(params.transaction.txnid)
        : "";
      return {
        paymentId: txnId || params.orderId,
        paymentUpdate: txnId ? { orangeMoneyTxnId: txnId } : {},
        auditTransactionId: txnId || null,
      };
    },
    settings: params.settings,
    sessionUserId: params.sessionUserId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
  });
}
