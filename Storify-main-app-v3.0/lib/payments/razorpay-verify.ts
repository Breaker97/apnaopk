import { ValidationError } from "@/lib/api/errors";
import type { SettingsDocument } from "@/lib/payments/finalize-order";
import {
  fetchRazorpayOrderPayments,
  fetchRazorpayPayment,
  getRazorpayCredentials,
  verifyRazorpayPaymentSignature,
  type RazorpayCredentials,
  type RazorpayPayment,
} from "@/lib/payments/razorpay";
import { finalizeRazorpayOrder } from "@/lib/payments/razorpay-orders";
import type {
  CheckoutPaymentScope,
  GatewayPaymentCheck,
} from "@/lib/payments/checkout-payment-check";

type RazorpayCheck = GatewayPaymentCheck<string> & { payment: RazorpayPayment | null };

function razorpayCheckoutCredentials(settings: SettingsDocument): RazorpayCredentials {
  const razorpay = settings.payment?.razorpay;
  if (!razorpay?.enabled) {
    throw new ValidationError("Razorpay is disabled");
  }
  return getRazorpayCredentials({
    keyId: razorpay.keyId,
    keySecret: razorpay.keySecret,
  });
}

function checkOf(
  params: { razorpayOrderId: string; settings: SettingsDocument } & CheckoutPaymentScope,
  creds: RazorpayCredentials,
  payment: RazorpayPayment,
): RazorpayCheck {
  return {
    state: String(payment.status),
    payment,
    settle: () =>
      finalizeRazorpayOrder({
        razorpayOrderId: params.razorpayOrderId,
        payment,
        creds,
        settings: params.settings,
        sessionUserId: params.sessionUserId,
        cartSessionId: params.cartSessionId,
        customerEmail: params.customerEmail,
      }),
  };
}

/**
 * The payment Razorpay Checkout handed back (its three fields), proven by the
 * signature over the order and payment ids under the store's key secret, read
 * back from Razorpay, and its settlement (`finalizeRazorpayOrder`, which
 * captures a payment Razorpay has only authorized).
 *
 * The core of POST /api/payments/razorpay/verify, and of the shopper app's
 * redirect verify when the return bridge brought the three fields back.
 */
export async function checkRazorpayPayment(
  params: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    settings: SettingsDocument;
  } & CheckoutPaymentScope,
): Promise<RazorpayCheck> {
  const creds = razorpayCheckoutCredentials(params.settings);

  const isValidSignature = verifyRazorpayPaymentSignature({
    orderId: params.razorpayOrderId,
    paymentId: params.razorpayPaymentId,
    signature: params.razorpaySignature,
    keySecret: creds.keySecret,
  });

  if (!isValidSignature) {
    throw new ValidationError("Razorpay payment signature mismatch");
  }

  const payment = await fetchRazorpayPayment({
    creds,
    paymentId: params.razorpayPaymentId,
  });

  return checkOf(params, creds, payment);
}

/**
 * A Razorpay order's payment read from Razorpay itself, for a payer who came
 * back without Checkout's fields (the browser was closed, or the payment
 * failed): the one that went through if any did, else the latest try, and
 * `created` with nothing to settle when nobody has tried yet.
 *
 * Razorpay's own API answering under the key secret stands in for the
 * signature here, as it does for the webhook.
 */
export async function checkRazorpayOrderPayments(
  params: { razorpayOrderId: string; settings: SettingsDocument } & CheckoutPaymentScope,
): Promise<RazorpayCheck> {
  const creds = razorpayCheckoutCredentials(params.settings);
  const payments = await fetchRazorpayOrderPayments({
    creds,
    razorpayOrderId: params.razorpayOrderId,
  });
  const payment =
    payments.find((entry) => entry.status === "captured" || entry.captured === true) ??
    payments.find((entry) => entry.status === "authorized") ??
    payments[0];
  if (!payment) {
    return {
      state: "created",
      payment: null,
      settle: () => Promise.reject(new ValidationError("Razorpay payment not found")),
    };
  }
  return checkOf(params, creds, payment);
}
