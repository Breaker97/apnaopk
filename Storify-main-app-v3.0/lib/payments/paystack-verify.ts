import { ValidationError } from "@/lib/api/errors";
import type { SettingsDocument } from "@/lib/payments/finalize-order";
import {
  getPaystackCredentials,
  verifyPaystackTransaction,
  type PaystackTransaction,
} from "@/lib/payments/paystack";
import { finalizePaystackOrder } from "@/lib/payments/paystack-orders";
import type {
  CheckoutPaymentScope,
  GatewayPaymentCheck,
} from "@/lib/payments/checkout-payment-check";

/** Refuses a checkout payment by Paystack while the store has it switched off. */
export function assertPaystackEnabled(settings: SettingsDocument): void {
  if (!settings.payment?.paystack?.enabled) {
    throw new ValidationError("Paystack is disabled");
  }
}

/**
 * A checkout's Paystack transaction, read back from Paystack by our reference,
 * and its settlement (`finalizePaystackOrder`: the attempt or the pending
 * order behind the reference, in the caller's scope).
 *
 * The core of POST /api/payments/paystack/verify, which settles whatever the
 * state, and of the shopper app's redirect verify, which settles only
 * `success`.
 */
export async function checkPaystackPayment(
  params: { reference: string; settings: SettingsDocument } & CheckoutPaymentScope,
): Promise<GatewayPaymentCheck<string> & { transaction: PaystackTransaction }> {
  const { reference, settings } = params;
  const paystack = settings.payment?.paystack;
  const creds = getPaystackCredentials({
    publicKey: paystack?.publicKey,
    secretKey: paystack?.secretKey,
  });
  const transaction = await verifyPaystackTransaction({ creds, reference });

  return {
    state: String(transaction.status),
    transaction,
    settle: () =>
      finalizePaystackOrder({
        reference,
        transaction,
        settings,
        sessionUserId: params.sessionUserId,
        cartSessionId: params.cartSessionId,
        customerEmail: params.customerEmail,
      }),
  };
}
