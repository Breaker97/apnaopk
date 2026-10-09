import "server-only";
import { PAYMENT_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import {
  recordAttemptGatewayRefs,
  recordAttemptTry,
  takeOverOpenAttempt,
} from "@/lib/checkout/checkout-attempt-store";
import { takeOverCheckoutAttempt } from "@/lib/checkout/checkout-attempts";
import { createOrder } from "@/lib/checkout/checkout-order-document";
import type { CheckoutDraft } from "@/lib/checkout/prepare-checkout";
import { isAttemptGateway } from "@/lib/payments/attempt-gateways";
import {
  createRazorpayOrder,
  getRazorpayCredentials,
  toRazorpayAmountSubunits,
} from "@/lib/payments/razorpay";
import {
  openGatewayAttempt,
  withAttempt,
  type GatewayStartRequest,
} from "./attempt";
import type { GatewayCheckoutRecord } from "./types";

export interface RazorpayCheckoutStart {
  record: GatewayCheckoutRecord;
  /** The store's public key, which Razorpay Checkout is opened with. */
  keyId: string;
  razorpayOrderId: string;
  /** In the currency's subunits, as Checkout takes it. */
  amount: number;
  currency: string;
  /** A retry of the same checkout, sent back to the Razorpay order it made. */
  resumed: boolean;
}

/**
 * Start paying for a prepared checkout with Razorpay: a Razorpay order for
 * what is due now, and the pending order (or, switched over, the checkout
 * attempt) its payment will settle.
 *
 * Razorpay has no hosted page to send the payer to: its Checkout runs in the
 * store's own page — the website's checkout, or the shopper app's pay page
 * (app/[locale]/app/pay/razorpay) — in redirect mode, with a `callback_url`
 * each of them chooses. So there is no return URL to pass here.
 */
export async function startRazorpayCheckout(
  draft: CheckoutDraft,
  options: { request: GatewayStartRequest },
): Promise<RazorpayCheckoutStart> {
  const {
    settings,
    cart,
    items,
    customerId,
    guestEmail,
    isMultiVendorEnabled,
    orderSettings,
    digitalOnly,
    normalizedShippingAddress,
    normalizedBillingAddress,
    checkoutDetails,
    subtotal,
    discount,
    tax,
    total,
    shippingCost,
    selectedShippingMethod,
    vendorShippingCosts,
    customsEstimate,
    pickupFulfillment,
    appliedCoupon,
    couponVendorShares,
    couponShippingShares,
    couponEligibleProductIds,
    paymentDueNow,
    activeLocale,
    attemptFingerprint,
    attemptFields,
    orderStoreCredit,
  } = draft;
  const razorpaySettings = settings.payment?.razorpay;

  if (!razorpaySettings?.enabled) {
    throw new ValidationError("Razorpay is disabled");
  }

  const razorpayCreds = getRazorpayCredentials({
    keyId: razorpaySettings.keyId,
    keySecret: razorpaySettings.keySecret,
  });
  const currency = (settings.general?.defaultCurrency || "INR").toUpperCase();
  const started = (
    record: GatewayCheckoutRecord,
    session: { razorpayOrderId: string; amount: number; currency: string },
    resumed = false,
  ): RazorpayCheckoutStart => ({
    record,
    keyId: razorpayCreds.keyId,
    ...session,
    resumed,
  });

  // Switched over to checkout attempts? Then nothing is written to the
  // orders collection here at all: the attempt carries the snapshot and
  // the gateway's reference, and an order is written when the money lands
  // (`lib/payments/finalize-attempt.ts`). The shopper's journey is
  // unchanged — the client only needs the Razorpay session — and the
  // verify route settles on `razorpayOrderId` either way.
  if (isAttemptGateway(settings, "razorpay")) {
    const reusable = await takeOverOpenAttempt({
      cartId: cart._id,
      paymentMethod: "razorpay",
      fingerprint: attemptFingerprint,
    });
    const reusableRazorpayOrderId = String(
      reusable?.gateway?.razorpayOrderId || "",
    );
    if (reusable && reusableRazorpayOrderId) {
      await recordAttemptTry(reusable._id);
      return started(
        { kind: "attempt", id: reusable._id, orderNumber: "" },
        {
          razorpayOrderId: reusableRazorpayOrderId,
          amount: toRazorpayAmountSubunits(paymentDueNow, currency),
          currency,
        },
        true,
      );
    }

    // The attempt exists before the gateway is asked, so its id can be the
    // receipt Razorpay quotes back and nothing can be paid for that has no
    // record here.
    const attempt = await openGatewayAttempt(draft, "razorpay", options.request);

    const session = await withAttempt(attempt._id, () =>
      createRazorpayOrder({
        creds: razorpayCreds,
        amount: paymentDueNow,
        currency,
        receipt: String(attempt._id),
        notes: {
          cartId: String(cart._id),
          customerId,
          locale: activeLocale,
          checkoutAttemptId: String(attempt._id),
        },
      }),
    );
    await recordAttemptGatewayRefs(attempt._id, {
      razorpayOrderId: session.id,
    });

    return started(
      { kind: "attempt", id: attempt._id, orderNumber: "" },
      {
        razorpayOrderId: session.id,
        amount: Number(session.amount),
        currency: String(session.currency),
      },
    );
  }

  // A Razorpay order takes any number of payment attempts until one
  // succeeds, so a retry of the same checkout simply opens it again.
  const previous = await takeOverCheckoutAttempt({
    cartId: cart._id,
    paymentMethod: "razorpay",
    fingerprint: attemptFingerprint,
  });
  if (previous?.razorpayOrderId) {
    return started(
      { kind: "order", id: previous._id, orderNumber: previous.orderNumber },
      {
        razorpayOrderId: previous.razorpayOrderId,
        amount: toRazorpayAmountSubunits(paymentDueNow, currency),
        currency,
      },
      true,
    );
  }

  const razorpayOrder = await createRazorpayOrder({
    creds: razorpayCreds,
    amount: paymentDueNow,
    currency,
    receipt: `cart_${String(cart._id).slice(-18)}_${Date.now().toString(36)}`,
    notes: {
      cartId: String(cart._id),
      customerId,
      locale: activeLocale,
    },
  });

  const order = await createOrder({
    ...checkoutDetails,
    storeCredit: orderStoreCredit,
    customerId,
    guestEmail,
    items,
    shippingAddress: normalizedShippingAddress,
    digitalOnly,
    billingAddress: normalizedBillingAddress,
    paymentMethod: "razorpay",
    shippingMethod: selectedShippingMethod,
    customs: customsEstimate,
    vendorShippingCosts,
    fulfillment: pickupFulfillment,
    paymentStatus: PAYMENT_STATUS.PENDING,
    subtotal,
    discount,
    shippingCost,
    tax,
    total,
    coupon: appliedCoupon
      ? {
          code: appliedCoupon.code,
          type: appliedCoupon.type,
          value: appliedCoupon.value,
          couponId: appliedCoupon.couponId,
          vendorShares: couponVendorShares,
          eligibleProductIds: couponEligibleProductIds,
          shippingShares: couponShippingShares,
          fundedBy: appliedCoupon.fundedBy,
        }
      : undefined,
    razorpayOrderId: razorpayOrder.id,
    ...attemptFields,
    isMultiVendorEnabled,
    orderPrefix: orderSettings.prefix,
    currency: settings.general?.defaultCurrency || "USD",
  });

  return started(
    { kind: "order", id: order._id, orderNumber: order.orderNumber },
    {
      razorpayOrderId: razorpayOrder.id,
      amount: Number(razorpayOrder.amount),
      currency: String(razorpayOrder.currency),
    },
  );
}
