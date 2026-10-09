import { ValidationError } from "@/lib/api/errors";
import type { AuditContext } from "@/lib/audit";
import type { SettingsDocument } from "@/lib/payments/finalize-order";
import {
  getPayPalOrderStatus,
  type PayPalCredentials,
} from "@/lib/payments/paypal";
import { finalizePayPalOrder } from "@/lib/payments/paypal-orders";
import { resolvePayPalCredentials } from "@/lib/settings/credentials";
import type {
  CheckoutPaymentScope,
  SettledCheckoutPayment,
} from "@/lib/payments/checkout-payment-check";

/**
 * The store's PayPal keys, refusing while PayPal is switched off or has
 * none: what every PayPal capture checks first.
 */
export function payPalCheckoutCredentials(settings: SettingsDocument): PayPalCredentials {
  const paypal = settings.payment?.paypal;
  if (!paypal?.enabled) throw new ValidationError("PayPal is disabled");
  const paypalCreds = resolvePayPalCredentials(paypal);
  if (!paypalCreds.clientId || !paypalCreds.clientSecret) {
    throw new ValidationError("PayPal is not configured");
  }
  return {
    clientId: paypalCreds.clientId,
    clientSecret: paypalCreds.clientSecret,
    mode: paypalCreds.mode,
  };
}

/**
 * Capture a checkout's approved PayPal order and settle the order (or
 * attempt) behind it, in the caller's scope. The money is taken inside the
 * finalizer, only for an order that is still pending and not cancelled; a
 * replayed capture answers with the order and takes nothing twice.
 *
 * The core of POST /api/payments/paypal/capture (after its platform, pay-link
 * and balance dispatch), and of the shopper app's redirect verify.
 */
export function settlePayPalCheckout(
  params: {
    paypalOrderId: string;
    creds: PayPalCredentials;
    settings: SettingsDocument;
    actor?: AuditContext;
  } & CheckoutPaymentScope,
): Promise<SettledCheckoutPayment> {
  return finalizePayPalOrder({
    paypalOrderId: params.paypalOrderId,
    creds: params.creds,
    settings: params.settings,
    sessionUserId: params.sessionUserId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
    actor: params.actor,
  });
}

/**
 * Where a PayPal order stands before anyone captures it: `CREATED` or
 * `PAYER_ACTION_REQUIRED` while the payer has not approved, `APPROVED` once
 * they have, `COMPLETED` once captured, `VOIDED`, or `NOT_FOUND` for one
 * PayPal has forgotten. The website captures straight away; the shopper app
 * asks first, so a payer who backed out is told so rather than refused.
 */
export async function readPayPalCheckoutState(params: {
  paypalOrderId: string;
  creds: PayPalCredentials;
}): Promise<string> {
  const { status } = await getPayPalOrderStatus({
    creds: params.creds,
    orderId: params.paypalOrderId,
  });
  return status;
}
