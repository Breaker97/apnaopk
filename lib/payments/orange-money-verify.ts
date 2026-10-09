import type { SettingsDocument } from "@/lib/payments/finalize-order";
import {
  getOrangeMoneyCredentials,
  getOrangeMoneyTransactionState,
  getOrangeMoneyTransactionStatus,
} from "@/lib/payments/orange-money";
import { finalizeOrangeMoneyOrder } from "@/lib/payments/orange-money-orders";
import { resolveOrangeMoneyCredentials } from "@/lib/settings/credentials";
import type {
  CheckoutPaymentScope,
  GatewayPaymentCheck,
} from "@/lib/payments/checkout-payment-check";

type OrangeMoneyState = ReturnType<typeof getOrangeMoneyTransactionState>;

/**
 * A checkout's Orange Money web payment, read from Orange's
 * `/transactionstatus` with the pay token stored at checkout, and its
 * settlement (`finalizeOrangeMoneyOrder`, in the caller's scope).
 *
 * The core of POST /api/payments/orange-money/verify (after it has found the
 * order and its pay token) and of the shopper app's redirect verify; both
 * settle only `completed`.
 */
export async function checkOrangeMoneyPayment(
  params: {
    /** Our reference, which Orange calls `order_id`. */
    orangeMoneyOrderId: string;
    payToken: string;
    /** What the order owes now (`amountDueNow`), which Orange is asked about. */
    amount: number;
    settings: SettingsDocument;
  } & CheckoutPaymentScope,
): Promise<GatewayPaymentCheck<OrangeMoneyState>> {
  const { orangeMoneyOrderId, settings } = params;
  const resolved = resolveOrangeMoneyCredentials(settings.payment?.orange_money);
  const creds = getOrangeMoneyCredentials(resolved);

  const transaction = await getOrangeMoneyTransactionStatus({
    creds,
    orderId: orangeMoneyOrderId,
    amount: params.amount,
    payToken: params.payToken,
  });

  return {
    state: getOrangeMoneyTransactionState(transaction),
    settle: () =>
      finalizeOrangeMoneyOrder({
        orderId: orangeMoneyOrderId,
        transaction,
        mode: creds.mode,
        settings,
        sessionUserId: params.sessionUserId,
        cartSessionId: params.cartSessionId,
        customerEmail: params.customerEmail,
      }),
  };
}
