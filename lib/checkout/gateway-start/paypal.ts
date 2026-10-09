import "server-only";
import { PAYMENT_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import {
  closeCheckoutAttempt,
  recordAttemptGatewayRefs,
  recordAttemptTry,
  takeOverOpenAttempt,
} from "@/lib/checkout/checkout-attempt-store";
import {
  retireCheckoutAttempt,
  takeOverCheckoutAttempt,
} from "@/lib/checkout/checkout-attempts";
import { createOrder } from "@/lib/checkout/checkout-order-document";
import type { CheckoutDraft } from "@/lib/checkout/prepare-checkout";
import { isAttemptGateway } from "@/lib/payments/attempt-gateways";
import { createPayPalOrder, readPayPalOrderCapture } from "@/lib/payments/paypal";
import { resolvePayPalCredentials } from "@/lib/settings/credentials";
import {
  openGatewayAttempt,
  withAttempt,
  type GatewayStartRequest,
} from "./attempt";
import type { GatewayCheckoutRecord } from "./types";

export interface PayPalCheckoutStart {
  record: GatewayCheckoutRecord;
  paypalOrderId: string;
  /** PayPal's page, where the payer approves. */
  approvalUrl: string;
  /** A retry of the same checkout, sent back to the PayPal order it made. */
  resumed: boolean;
}

/**
 * Start paying for a prepared checkout with PayPal: a PayPal order for what
 * is due now, and the pending order (or, switched over, the checkout attempt)
 * its capture will settle. Nothing is taken here — PayPal moves the money
 * only when the capture runs (lib/payments/paypal-verify.ts).
 *
 * `returnUrl` and `cancelUrl` are where PayPal sends the payer: the website's
 * own pages, or the shopper app's return bridge. PayPal adds `token` (its
 * order id) and `PayerID` to the first.
 */
export async function startPayPalCheckout(
  draft: CheckoutDraft,
  options: { returnUrl: string; cancelUrl: string; request: GatewayStartRequest },
): Promise<PayPalCheckoutStart> {
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
    attemptFingerprint,
    attemptFields,
    orderStoreCredit,
  } = draft;
  const { returnUrl, cancelUrl } = options;
  const paypalSettings = settings.payment?.paypal;

  if (!paypalSettings?.enabled)
    throw new ValidationError("PayPal is disabled");
  const paypalCreds = resolvePayPalCredentials(paypalSettings);
  if (!paypalCreds.clientId || !paypalCreds.clientSecret) {
    throw new ValidationError("PayPal is not configured");
  }

  if (isAttemptGateway(settings, "paypal")) {
    const reusable = await takeOverOpenAttempt({
      cartId: cart._id,
      paymentMethod: "paypal",
      fingerprint: attemptFingerprint,
    });
    const reusableOrderId = String(reusable?.gateway?.paypalOrderId || "");
    const reusableUrl = String(reusable?.gateway?.checkoutUrl || "");
    if (reusable && reusableOrderId && reusableUrl) {
      // Only a PayPal order still waiting for the payer is worth going
      // back to. One already approved or captured is settled by the
      // finalizer, not restarted.
      const state = await readPayPalOrderCapture({
        creds: {
          clientId: paypalCreds.clientId,
          clientSecret: paypalCreds.clientSecret,
          mode: paypalCreds.mode,
        },
        orderId: reusableOrderId,
      }).catch(() => null);
      const status = String(
        (state?.raw as { status?: string } | undefined)?.status || "",
      ).toUpperCase();
      if (status === "CREATED" || status === "PAYER_ACTION_REQUIRED") {
        await recordAttemptTry(reusable._id);
        return {
          record: { kind: "attempt", id: reusable._id, orderNumber: "" },
          paypalOrderId: reusableOrderId,
          approvalUrl: reusableUrl,
          resumed: true,
        };
      }
      await closeCheckoutAttempt(reusable._id, "superseded");
    } else if (reusable) {
      await closeCheckoutAttempt(reusable._id, "superseded");
    }

    const attempt = await openGatewayAttempt(draft, "paypal", options.request);
    // Read out here rather than inside the closure: the guard above proved
    // they are set, and a deferred call loses that narrowing.
    const paypalCall = {
      clientId: paypalCreds.clientId,
      clientSecret: paypalCreds.clientSecret,
      mode: paypalCreds.mode,
    };
    const created = await withAttempt(attempt._id, () =>
      createPayPalOrder({
        creds: paypalCall,
        currency: (settings.general?.defaultCurrency || "USD").toUpperCase(),
        total: paymentDueNow,
        returnUrl,
        cancelUrl,
        // PayPal quotes this back on the capture, so it names the attempt.
        referenceId: String(attempt._id),
      }),
    );
    await recordAttemptGatewayRefs(attempt._id, {
      paypalOrderId: created.orderId,
      checkoutUrl: created.approvalUrl,
    });

    return {
      record: { kind: "attempt", id: attempt._id, orderNumber: "" },
      paypalOrderId: created.orderId,
      approvalUrl: created.approvalUrl,
      resumed: false,
    };
  }

  // A retry of the same checkout goes back to the PayPal order already
  // made, while PayPal will still take a payment on it.
  const previous = await takeOverCheckoutAttempt({
    cartId: cart._id,
    paymentMethod: "paypal",
    fingerprint: attemptFingerprint,
  });
  if (previous?.paypalOrderId && previous.gatewayCheckoutUrl) {
    const state = await readPayPalOrderCapture({
      creds: {
        clientId: paypalCreds.clientId,
        clientSecret: paypalCreds.clientSecret,
        mode: paypalCreds.mode,
      },
      orderId: previous.paypalOrderId,
    }).catch(() => null);
    const status = String(
      (state?.raw as { status?: string } | undefined)?.status || "",
    ).toUpperCase();
    if (status === "CREATED" || status === "PAYER_ACTION_REQUIRED") {
      return {
        record: { kind: "order", id: previous._id, orderNumber: previous.orderNumber },
        paypalOrderId: previous.paypalOrderId,
        approvalUrl: previous.gatewayCheckoutUrl,
        resumed: true,
      };
    }
    // Approved, captured, voided or unreadable: not a page to send anyone
    // back to. A capture still in flight settles against the cancelled
    // order and is refunded.
    await retireCheckoutAttempt(previous._id);
  } else if (previous) {
    await retireCheckoutAttempt(previous._id);
  }

  const { orderId: paypalOrderId, approvalUrl } = await createPayPalOrder({
    creds: {
      clientId: paypalCreds.clientId,
      clientSecret: paypalCreds.clientSecret,
      mode: paypalCreds.mode,
    },
    currency: (settings.general?.defaultCurrency || "USD").toUpperCase(),
    total: paymentDueNow,
    returnUrl,
    cancelUrl,
    referenceId: String(cart._id),
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
    paymentMethod: "paypal",
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
    paypalOrderId,
    ...attemptFields,
    gatewayCheckoutUrl: approvalUrl,
    isMultiVendorEnabled,
    orderPrefix: orderSettings.prefix,
    currency: settings.general?.defaultCurrency || "USD",
  });

  return {
    record: { kind: "order", id: order._id, orderNumber: order.orderNumber },
    paypalOrderId,
    approvalUrl,
    resumed: false,
  };
}
