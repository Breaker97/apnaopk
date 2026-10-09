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
  getPaystackCredentials,
  initializePaystackTransaction,
} from "@/lib/payments/paystack";
import {
  openGatewayAttempt,
  withAttempt,
  type GatewayStartRequest,
} from "./attempt";
import type { GatewayCheckoutRecord } from "./types";

export interface PaystackCheckoutStart {
  record: GatewayCheckoutRecord;
  /** Our reference for the transaction, which Paystack verifies by. */
  reference: string;
  /** Paystack's hosted page. */
  authorizationUrl: string;
  /** Paystack's access code, on a transaction this call initialized for an order. */
  accessCode?: string;
  /** A retry of the same checkout, sent back to the page it made. */
  resumed: boolean;
}

/**
 * Start paying for a prepared checkout with Paystack: a transaction for what
 * is due now on Paystack's hosted page, and the pending order (or, switched
 * over, the checkout attempt) its verification will settle.
 *
 * `callbackUrl` builds where Paystack sends the payer back from our own
 * reference: the website's success page, or the shopper app's return bridge.
 * Paystack adds `reference` and `trxref` to it.
 */
export async function startPaystackCheckout(
  draft: CheckoutDraft,
  options: { callbackUrl: (reference: string) => string; request: GatewayStartRequest },
): Promise<PaystackCheckoutStart> {
  const {
    settings,
    cart,
    items,
    customerEmail,
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
  const paystackSettings = settings.payment?.paystack;

  if (!paystackSettings?.enabled) {
    throw new ValidationError("Paystack is disabled");
  }
  if (!customerEmail) {
    throw new ValidationError({
      email: ["Email is required for Paystack checkout"],
    });
  }

  const paystackCreds = getPaystackCredentials({
    publicKey: paystackSettings.publicKey,
    secretKey: paystackSettings.secretKey,
  });
  const currency = (settings.general?.defaultCurrency || "NGN").toUpperCase();

  if (isAttemptGateway(settings, "paystack")) {
    const reusable = await takeOverOpenAttempt({
      cartId: cart._id,
      paymentMethod: "paystack",
      fingerprint: attemptFingerprint,
    });
    const reference = String(reusable?.gateway?.paystackReference || "");
    const hostedUrl = String(reusable?.gateway?.checkoutUrl || "");
    if (reusable && reference && hostedUrl) {
      await recordAttemptTry(reusable._id);
      return {
        record: { kind: "attempt", id: reusable._id, orderNumber: "" },
        reference,
        authorizationUrl: hostedUrl,
        resumed: true,
      };
    }

    // The attempt first, so Paystack's reference is built from its id and
    // every payment has a record here to land on.
    const attempt = await openGatewayAttempt(draft, "paystack", options.request);
    const attemptReference = `ps-${String(attempt._id)}-${Date.now().toString(36)}`;
    const transaction = await withAttempt(attempt._id, () =>
      initializePaystackTransaction({
        creds: paystackCreds,
        email: customerEmail,
        amount: paymentDueNow,
        currency,
        reference: attemptReference,
        callbackUrl: options.callbackUrl(attemptReference),
        metadata: {
          cartId: String(cart._id),
          customerId,
          locale: activeLocale,
          checkoutAttemptId: String(attempt._id),
        },
      }),
    );
    await recordAttemptGatewayRefs(attempt._id, {
      paystackReference: attemptReference,
      checkoutUrl: transaction.authorization_url,
    });

    return {
      record: { kind: "attempt", id: attempt._id, orderNumber: "" },
      reference: attemptReference,
      authorizationUrl: transaction.authorization_url,
      resumed: false,
    };
  }

  // Paystack's checkout page for a reference stays payable until it is
  // paid, so a retry of the same checkout goes back to it.
  const previous = await takeOverCheckoutAttempt({
    cartId: cart._id,
    paymentMethod: "paystack",
    fingerprint: attemptFingerprint,
  });
  if (previous?.paystackReference && previous.gatewayCheckoutUrl) {
    return {
      record: { kind: "order", id: previous._id, orderNumber: previous.orderNumber },
      reference: previous.paystackReference,
      authorizationUrl: previous.gatewayCheckoutUrl,
      resumed: true,
    };
  }

  const paystackReference = `ps-${String(cart._id)}-${Date.now().toString(36)}`;

  const transaction = await initializePaystackTransaction({
    creds: paystackCreds,
    email: customerEmail,
    amount: paymentDueNow,
    currency,
    reference: paystackReference,
    callbackUrl: options.callbackUrl(paystackReference),
    metadata: {
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
    paymentMethod: "paystack",
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
    paystackReference,
    ...attemptFields,
    gatewayCheckoutUrl: transaction.authorization_url,
    isMultiVendorEnabled,
    orderPrefix: orderSettings.prefix,
    currency: settings.general?.defaultCurrency || "USD",
  });

  return {
    record: { kind: "order", id: order._id, orderNumber: order.orderNumber },
    reference: paystackReference,
    authorizationUrl: transaction.authorization_url,
    accessCode: transaction.access_code,
    resumed: false,
  };
}
