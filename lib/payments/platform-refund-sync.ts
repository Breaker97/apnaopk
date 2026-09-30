import "server-only";

import { PlatformPayment } from "@/models";
import {
  fetchRazorpayPayment,
  fromRazorpayAmountSubunits,
  type RazorpayCredentials,
} from "@/lib/payments/razorpay";
import {
  fromPaystackAmountSubunits,
  listPaystackRefunds,
} from "@/lib/payments/paystack";
import { PAYSTACK_LIVE_REFUND_STATUSES } from "@/lib/orders/dispute-readings";
import { applyPlatformPaymentRefundTotal } from "@/lib/boosts/boost-billing";

/**
 * Refunds of the marketplace's own payments — a boost, a subscription, a
 * commission bill — made from a gateway's dashboard, for the gateways other
 * than Stripe. Each asks the gateway what has been refunded on the payment in
 * total and hands that to `applyPlatformPaymentRefundTotal`, and each does
 * nothing, without an API call, for a payment that is not a platform payment
 * — most refunds are on shoppers' orders.
 */

export async function syncRazorpayPlatformRefund(params: {
  paymentId: string;
  creds: RazorpayCredentials;
}): Promise<boolean> {
  if (!params.paymentId) return false;
  if (!(await PlatformPayment.exists({ razorpayPaymentId: params.paymentId }))) {
    return false;
  }
  const payment = await fetchRazorpayPayment({
    creds: params.creds,
    paymentId: params.paymentId,
  });
  return applyPlatformPaymentRefundTotal({
    locate: { razorpayPaymentId: params.paymentId },
    refundedTotalMajor: fromRazorpayAmountSubunits(
      Number(payment.amount_refunded || 0),
      String(payment.currency || "INR"),
    ),
  });
}

export async function syncPaystackPlatformRefund(params: {
  transaction: { id?: string; reference?: string };
  secretKey: string;
}): Promise<boolean> {
  const id = String(params.transaction.id || "");
  const reference = String(params.transaction.reference || "");
  if (!id && !reference) return false;
  const exists = await PlatformPayment.exists({
    $or: [
      ...(id ? [{ paystackTransactionId: id }] : []),
      ...(reference ? [{ reference }] : []),
    ],
  });
  if (!exists) return false;
  const refunds = await listPaystackRefunds({
    creds: { secretKey: params.secretKey },
    transaction: { id, reference },
  });
  // Money on its way back or already back; a failed refund gave none.
  const total = refunds.reduce((sum, refund) => {
    if (!PAYSTACK_LIVE_REFUND_STATUSES.has(String(refund.status || "").toLowerCase())) {
      return sum;
    }
    return (
      sum +
      fromPaystackAmountSubunits(Number(refund.amount || 0), String(refund.currency || "NGN"))
    );
  }, 0);
  return applyPlatformPaymentRefundTotal({
    locate: {
      ...(id ? { paystackTransactionId: id } : {}),
      ...(reference ? { reference } : {}),
    },
    refundedTotalMajor: total,
  });
}

/**
 * PayPal quotes the running total on the refund itself —
 * `seller_payable_breakdown.total_refunded_amount` — so no second call is
 * needed. A refund without it says nothing reliable about the total, and is
 * left alone rather than guessed at.
 */
export async function syncPayPalPlatformRefund(refund: {
  status?: string;
  links?: Array<{ rel?: string; href?: string }> | null;
  capture_id?: string;
  seller_payable_breakdown?: {
    total_refunded_amount?: { value?: string } | null;
  } | null;
}): Promise<boolean> {
  const linked = (refund.links || []).find(
    (link) => String(link?.rel || "").toLowerCase() === "up",
  )?.href;
  const captureId =
    refund.capture_id || (linked ? linked.split("/").filter(Boolean).pop() : "") || "";
  if (!captureId) return false;
  if (!(await PlatformPayment.exists({ paypalCaptureId: captureId }))) return false;
  const total = Number(refund.seller_payable_breakdown?.total_refunded_amount?.value);
  if (!Number.isFinite(total) || total <= 0) return false;
  return applyPlatformPaymentRefundTotal({
    locate: { paypalCaptureId: captureId },
    refundedTotalMajor: total,
  });
}
