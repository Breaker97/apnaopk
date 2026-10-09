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
import { storeCurrencyCode } from "@/lib/payments/gateway-currencies";
import {
  getPesapalCredentials,
  normalizePesapalCountryCode,
  submitPesapalOrder,
} from "@/lib/payments/pesapal";
import { resolvePesapalCredentials } from "@/lib/settings/credentials";
import {
  openGatewayAttempt,
  withAttempt,
  type GatewayStartRequest,
} from "./attempt";
import type { GatewayCheckoutRecord } from "./types";

export interface PesapalCheckoutStart {
  record: GatewayCheckoutRecord;
  /** Pesapal's id for the payment, which its status is read by. */
  orderTrackingId: string;
  /** Our reference for it. */
  merchantReference: string;
  /** Pesapal's hosted page. */
  redirectUrl: string;
  /** A retry of the same checkout, sent back to the page it made. */
  resumed: boolean;
}

/**
 * Start paying for a prepared checkout with Pesapal: an order on Pesapal's
 * hosted page for what is due now, and the pending order (or, switched over,
 * the checkout attempt) its status read or IPN will settle.
 *
 * `callbackUrl` builds where Pesapal sends the payer back from our merchant
 * reference, and `cancellationUrl` is where a payer who gives up goes: the
 * website's pages, or the shopper app's return bridge. Pesapal adds
 * `OrderTrackingId` and `OrderMerchantReference` to the first.
 */
export async function startPesapalCheckout(
  draft: CheckoutDraft,
  options: {
    callbackUrl: (merchantReference: string) => string;
    cancellationUrl: string;
    request: GatewayStartRequest;
  },
): Promise<PesapalCheckoutStart> {
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
    attemptFingerprint,
    attemptFields,
    orderStoreCredit,
  } = draft;
  const pesapalSettings = settings.payment?.pesapal;

  if (!pesapalSettings?.enabled) {
    throw new ValidationError("Pesapal is disabled");
  }
  if (!customerEmail) {
    throw new ValidationError({
      email: ["Email is required for Pesapal checkout"],
    });
  }

  const resolvedPesapal = resolvePesapalCredentials(pesapalSettings);
  const pesapalCreds = getPesapalCredentials(resolvedPesapal);
  if (!pesapalCreds.ipnId) {
    throw new ValidationError(
      "Pesapal is not configured. Register the IPN URL and add its IPN ID.",
    );
  }

  // One Pesapal settles — prepareCheckout's currency gate turned away any
  // other.
  const currency = storeCurrencyCode(settings);
  if (isAttemptGateway(settings, "pesapal")) {
    const reusable = await takeOverOpenAttempt({
      cartId: cart._id,
      paymentMethod: "pesapal",
      fingerprint: attemptFingerprint,
    });
    const trackingId = String(
      reusable?.gateway?.pesapalOrderTrackingId || "",
    );
    const merchantRef = String(
      reusable?.gateway?.pesapalMerchantReference || "",
    );
    const hostedUrl = String(reusable?.gateway?.checkoutUrl || "");
    if (reusable && trackingId && merchantRef && hostedUrl) {
      await recordAttemptTry(reusable._id);
      return {
        record: { kind: "attempt", id: reusable._id, orderNumber: "" },
        orderTrackingId: trackingId,
        merchantReference: merchantRef,
        redirectUrl: hostedUrl,
        resumed: true,
      };
    }

    const attempt = await openGatewayAttempt(draft, "pesapal", options.request);
    // Same reason as PayPal's: the guard's narrowing does not survive
    // being read inside a deferred call.
    const pesapalIpnId = pesapalCreds.ipnId;
    const attemptReference = `psp-${String(attempt._id).slice(-18)}-${Date.now().toString(36)}`;
    const nameParts = normalizedBillingAddress.fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const givenName =
      normalizedBillingAddress.firstName || nameParts[0] || "Customer";
    const submitted = await withAttempt(attempt._id, async () => {
      const response = await submitPesapalOrder({
        creds: pesapalCreds,
        merchantReference: attemptReference,
        currency,
        amount: paymentDueNow,
        description: `Store checkout ${attemptReference}`,
        callbackUrl: options.callbackUrl(attemptReference),
        cancellationUrl: options.cancellationUrl,
        notificationId: pesapalIpnId,
        billingAddress: {
          email_address: customerEmail,
          phone_number: normalizedBillingAddress.phone,
          country_code: normalizePesapalCountryCode(
            normalizedBillingAddress.country,
          ),
          first_name: givenName,
          last_name:
            normalizedBillingAddress.lastName ||
            nameParts.slice(1).join(" ") ||
            givenName,
          line_1: normalizedBillingAddress.street,
          line_2: normalizedBillingAddress.apartment,
          city: normalizedBillingAddress.city,
          state: normalizedBillingAddress.state,
          postal_code: normalizedBillingAddress.postalCode,
          zip_code: normalizedBillingAddress.postalCode,
        },
      });

      if (
        !response.order_tracking_id ||
        !response.redirect_url ||
        response.merchant_reference !== attemptReference
      ) {
        throw new ValidationError(
          "Pesapal returned an invalid order response",
        );
      }
      return response;
    });

    await recordAttemptGatewayRefs(attempt._id, {
      pesapalOrderTrackingId: submitted.order_tracking_id,
      pesapalMerchantReference: attemptReference,
      checkoutUrl: submitted.redirect_url,
    });

    return {
      record: { kind: "attempt", id: attempt._id, orderNumber: "" },
      orderTrackingId: submitted.order_tracking_id,
      merchantReference: attemptReference,
      redirectUrl: submitted.redirect_url,
      resumed: false,
    };
  }

  // Pesapal's hosted page is reused only while it is fresh (an hour);
  // older attempts are cancelled and a new page is made.
  const previous = await takeOverCheckoutAttempt({
    cartId: cart._id,
    paymentMethod: "pesapal",
    fingerprint: attemptFingerprint,
  });
  if (
    previous?.pesapalOrderTrackingId &&
    previous.pesapalMerchantReference &&
    previous.gatewayCheckoutUrl
  ) {
    return {
      record: { kind: "order", id: previous._id, orderNumber: previous.orderNumber },
      orderTrackingId: previous.pesapalOrderTrackingId,
      merchantReference: previous.pesapalMerchantReference,
      redirectUrl: previous.gatewayCheckoutUrl,
      resumed: true,
    };
  }

  const merchantReference = `psp-${String(cart._id).slice(-18)}-${Date.now().toString(36)}`;
  const fullNameParts = normalizedBillingAddress.fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const firstName =
    normalizedBillingAddress.firstName || fullNameParts[0] || "Customer";
  const lastName =
    normalizedBillingAddress.lastName ||
    fullNameParts.slice(1).join(" ") ||
    firstName;

  const pesapalOrder = await submitPesapalOrder({
    creds: pesapalCreds,
    merchantReference,
    currency,
    amount: paymentDueNow,
    description: `Store checkout ${merchantReference}`,
    callbackUrl: options.callbackUrl(merchantReference),
    cancellationUrl: options.cancellationUrl,
    notificationId: pesapalCreds.ipnId,
    billingAddress: {
      email_address: customerEmail,
      phone_number: normalizedBillingAddress.phone,
      country_code: normalizePesapalCountryCode(
        normalizedBillingAddress.country,
      ),
      first_name: firstName,
      last_name: lastName,
      line_1: normalizedBillingAddress.street,
      line_2: normalizedBillingAddress.apartment,
      city: normalizedBillingAddress.city,
      state: normalizedBillingAddress.state,
      postal_code: normalizedBillingAddress.postalCode,
      zip_code: normalizedBillingAddress.postalCode,
    },
  });

  if (
    !pesapalOrder.order_tracking_id ||
    !pesapalOrder.redirect_url ||
    pesapalOrder.merchant_reference !== merchantReference
  ) {
    throw new ValidationError("Pesapal returned an invalid order response");
  }

  const order = await createOrder({
    ...checkoutDetails,
    storeCredit: orderStoreCredit,
    customerId,
    guestEmail,
    items,
    shippingAddress: normalizedShippingAddress,
    digitalOnly,
    billingAddress: normalizedBillingAddress,
    paymentMethod: "pesapal",
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
    pesapalOrderTrackingId: pesapalOrder.order_tracking_id,
    pesapalMerchantReference: merchantReference,
    ...attemptFields,
    gatewayCheckoutUrl: pesapalOrder.redirect_url,
    isMultiVendorEnabled,
    orderPrefix: orderSettings.prefix,
    // Must match the currency the charge was submitted in — the finalizer
    // compares the gateway's currency against the order's.
    currency,
  });

  return {
    record: { kind: "order", id: order._id, orderNumber: order.orderNumber },
    orderTrackingId: pesapalOrder.order_tracking_id,
    merchantReference,
    redirectUrl: pesapalOrder.redirect_url,
    resumed: false,
  };
}
