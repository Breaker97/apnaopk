import "server-only";

import { createHash } from "node:crypto";
import { Order } from "@/models";
import { PAYMENT_STATUS } from "@/config/app.config";
import {
  LIVE_ATTEMPT,
  REUSABLE_ATTEMPT_METHODS,
  WRITTEN_OFF_ATTEMPT,
  retireCheckoutAttempt,
  type ReusableAttemptMethod,
} from "@/lib/checkout/superseded-orders";

export { retireCartCheckoutAttempts, retireCheckoutAttempt } from "@/lib/checkout/superseded-orders";

/**
 * One pending order per cart for the redirect gateways.
 *
 * A redirect gateway needs an order before the shopper leaves — it is what the
 * gateway's reference is written on, so the payment can find its order when it
 * comes back, even if the shopper never does. But every "Continue with
 * Razorpay" wrote a new one: a shopper who closed the gateway window and tried
 * again three times left three pending orders, all for the same cart, filling
 * the admin and vendor lists with orders nobody would ever pay.
 *
 * Now a retry from the same cart, on the same gateway, for exactly the same
 * thing, gets the same order back — and the same gateway session where the
 * gateway can still take a payment on it, so there is only ever one place the
 * money can land. Anything else about the cart's earlier attempts — a
 * different gateway, a changed cart, a session that can no longer be paid — is
 * cancelled as superseded. That is safe for money in flight: a payment that
 * still arrives on a cancelled order is refunded by `finalizeCapturedOrder`,
 * never lost, and a pending gateway order holds no stock, quota or coupon use.
 *
 * Only the redirect gateways (`REUSABLE_ATTEMPT_METHODS`) while a payment may
 * still arrive. An order the expiry sweep has written off is retired whatever
 * its gateway: it cannot be reused, and its pay link must not outlive the
 * checkout. The retiring itself lives in `superseded-orders.ts`.
 */

/** How long an attempt stays worth returning to. */
const ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Pesapal's hosted page is short-lived; a stale one sends the shopper nowhere. */
const PESAPAL_WINDOW_MS = 60 * 60 * 1000;

/** The window a gateway's attempt gets, whichever shape it is stored in. */
export function attemptWindowMs(paymentMethod: string): number {
  return String(paymentMethod || "").toLowerCase() === "pesapal"
    ? PESAPAL_WINDOW_MS
    : ATTEMPT_WINDOW_MS;
}

/**
 * A stable hash of everything the order was placed for. Two attempts with the
 * same hash would write the same order, so the first one can stand in for the
 * second.
 */
export function checkoutAttemptFingerprint(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // ObjectIds and other wrapped ids compare by their string form.
    if (typeof (record as { toHexString?: unknown }).toHexString === "function") {
      return JSON.stringify(String(value));
    }
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "number") {
    // Money: two-decimal float noise must not read as a different order.
    return JSON.stringify(Math.round(value * 10000) / 10000);
  }
  return JSON.stringify(value);
}

type PendingAttempt = {
  _id: unknown;
  orderNumber: string;
  paymentMethod?: string;
  paymentStatus?: string;
  checkoutFingerprint?: string;
  gatewayCheckoutUrl?: string;
  razorpayOrderId?: string;
  paypalOrderId?: string;
  paystackReference?: string;
  pesapalOrderTrackingId?: string;
  pesapalMerchantReference?: string;
  currency?: string;
  createdAt?: Date;
};

/**
 * The cart's attempt this checkout can pick up again, or null. Every other
 * live attempt from the cart on these gateways is cancelled as superseded —
 * after this call the cart has at most the one returned. So is every order
 * of the cart the expiry sweep wrote off: the shopper is paying again, and
 * the link in its failure email would otherwise collect for the same goods a
 * second time.
 *
 * The caller still decides whether the returned attempt's gateway session is
 * payable (PayPal is asked); if it is not, `retireCheckoutAttempt` it and
 * start a new one.
 */
export async function takeOverCheckoutAttempt(params: {
  cartId: unknown;
  paymentMethod: ReusableAttemptMethod;
  fingerprint: string;
  now?: Date;
}): Promise<PendingAttempt | null> {
  const now = params.now ?? new Date();
  const attempts = await Order.find({
    checkoutCartId: params.cartId,
    $or: [
      { ...LIVE_ATTEMPT, paymentMethod: { $in: REUSABLE_ATTEMPT_METHODS } },
      WRITTEN_OFF_ATTEMPT,
    ],
  })
    .select(
      "_id orderNumber paymentMethod paymentStatus checkoutFingerprint gatewayCheckoutUrl razorpayOrderId paypalOrderId paystackReference pesapalOrderTrackingId pesapalMerchantReference currency createdAt",
    )
    .sort({ createdAt: -1 })
    .lean<PendingAttempt[]>();

  const reusable = attempts.find((attempt) =>
    isReusable(attempt, params.paymentMethod, params.fingerprint, now),
  );
  const superseded = attempts.filter((attempt) => attempt !== reusable);
  await Promise.all(superseded.map((attempt) => retireCheckoutAttempt(attempt._id)));
  return reusable ?? null;
}

function isReusable(
  attempt: PendingAttempt,
  paymentMethod: ReusableAttemptMethod,
  fingerprint: string,
  now: Date,
): boolean {
  // Written off: the gateway session was given up on, and picking it up again
  // would send the shopper back to a payment the store has already closed.
  if (attempt.paymentStatus === PAYMENT_STATUS.EXPIRED) return false;
  if (attempt.paymentMethod !== paymentMethod) return false;
  if (!attempt.checkoutFingerprint || attempt.checkoutFingerprint !== fingerprint) {
    return false;
  }
  const age = now.getTime() - new Date(attempt.createdAt ?? 0).getTime();
  const window = attemptWindowMs(paymentMethod);
  if (!(age >= 0 && age <= window)) return false;
  // Something to send the shopper back to.
  return paymentMethod === "razorpay"
    ? Boolean(attempt.razorpayOrderId)
    : Boolean(attempt.gatewayCheckoutUrl);
}
