import { ValidationError } from "@/lib/api/errors";
import type { SettingsDocument } from "@/lib/payments/finalize-order";
import {
  getPesapalCredentials,
  getPesapalTransactionState,
  getPesapalTransactionStatus,
} from "@/lib/payments/pesapal";
import {
  finalizePesapalOrder,
  reversePesapalOrder,
} from "@/lib/payments/pesapal-orders";
import { resolvePesapalCredentials } from "@/lib/settings/credentials";
import type {
  CheckoutPaymentScope,
  GatewayPaymentCheck,
} from "@/lib/payments/checkout-payment-check";

type PesapalState = ReturnType<typeof getPesapalTransactionState>;

/**
 * A checkout's Pesapal payment, read from Pesapal by its tracking id and held
 * to the merchant reference recorded with it, and its settlement
 * (`finalizePesapalOrder`, in the caller's scope). A payment Pesapal has
 * since reversed is walked back here, whoever asks.
 *
 * The core of POST /api/payments/pesapal/verify (after it has found the
 * order) and of the shopper app's redirect verify; both settle only
 * `completed`.
 */
export async function checkPesapalPayment(
  params: {
    orderTrackingId: string;
    /** The merchant reference the order (or attempt) was submitted with. */
    recordedMerchantReference: string | undefined;
    /** The one the payer's return carried, when it carried one. */
    merchantReference?: string;
    settings: SettingsDocument;
  } & CheckoutPaymentScope,
): Promise<GatewayPaymentCheck<PesapalState>> {
  const { orderTrackingId, settings } = params;
  const resolved = resolvePesapalCredentials(settings.payment?.pesapal);
  const creds = getPesapalCredentials(resolved);
  const transaction = await getPesapalTransactionStatus({
    creds,
    orderTrackingId,
  });

  if (transaction.merchant_reference !== params.recordedMerchantReference) {
    throw new ValidationError("Pesapal merchant reference mismatch");
  }

  const state = getPesapalTransactionState(transaction);
  if (state === "reversed") {
    // The shopper can land here after a reversal too — walk the capture back
    // instead of reporting a status nobody acts on.
    await reversePesapalOrder({ orderTrackingId, settings });
  }

  return {
    state,
    settle: () =>
      finalizePesapalOrder({
        orderTrackingId,
        merchantReference: params.merchantReference || undefined,
        transaction,
        settings,
        sessionUserId: params.sessionUserId,
        cartSessionId: params.cartSessionId,
        customerEmail: params.customerEmail,
      }),
  };
}
