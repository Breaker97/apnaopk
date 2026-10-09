import "server-only";
import { randomUUID } from "crypto";
import { PAYMENT_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { createOrder } from "@/lib/checkout/checkout-order-document";
import type { CheckoutDraft } from "@/lib/checkout/prepare-checkout";
import { currencyMinorUnitExponent } from "@/lib/intl/money";
import { reserveAsyncPushInventory } from "@/lib/orders/async-push-inventory";
import { retireRefusedGatewayOrder } from "@/lib/orders/refused-gateway-order";
import { storeCurrencyCode } from "@/lib/payments/gateway-currencies";
import {
  getMtnMomoCredentials,
  MtnMomoApiError,
  mtnMomoCallbackUrl,
  mtnMomoChargeCurrency,
  normalizeMtnMomoMsisdn,
  requestMtnMomoPayment,
} from "@/lib/payments/mtn-momo";
import { resolveMtnMomoCredentials } from "@/lib/settings/credentials";

/**
 * Start an MTN MoMo payment from a prepared checkout
 * (`prepareCheckout(…, { mode: "place" })`): the order is written pending with
 * the reference we mint, its goods held, then `requesttopay` puts a PIN
 * prompt on the payer's phone.
 *
 * Moved here from app/api/payments/checkout/route.ts, which answers with what
 * this returns; so does the shopper app's POST /checkout/push, which stamps
 * the order with its `idempotencyKey`.
 *
 * Throws `MtnMomoApiError` when MTN answered with an error, after retiring the
 * order only if that answer was a definitive refusal (a 4xx); any other
 * failure leaves the order pending for the reconcile sweep, because MTN may
 * have queued the request and prompted the payer anyway.
 */
export async function startMtnMomoPayment(
  draft: CheckoutDraft,
  options: {
    /** The mobile-money number; the billing phone when left out. */
    phone?: string;
    idempotencyKey?: string;
  } = {},
) {
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
    orderStoreCredit,
  } = draft;
  const mtnMomoSettings = settings.payment?.mtn_momo;

  if (!mtnMomoSettings?.enabled) {
    throw new ValidationError("MTN MoMo is disabled");
  }

  const resolvedMtnMomo = resolveMtnMomoCredentials(mtnMomoSettings);
  const mtnMomoCreds = getMtnMomoCredentials(resolvedMtnMomo);

  // One the wallet settles — the gate in `prepareCheckout` turned away any
  // other.
  const currency = storeCurrencyCode(settings);

  // requesttopay takes major units. In a zero-decimal currency a
  // fractional total would be rounded by the gateway and then fail the
  // finalizer's amount cross-check — after the payer's money had moved.
  if (
    currencyMinorUnitExponent(currency) === 0 &&
    !Number.isInteger(paymentDueNow)
  ) {
    throw new ValidationError(
      `${currency} has no minor unit, so ${paymentDueNow} cannot be charged. Round the cart total to a whole ${currency}.`,
    );
  }

  const payerMsisdn = normalizeMtnMomoMsisdn(
    options.phone || normalizedBillingAddress.phone,
    mtnMomoCreds.targetEnvironment,
  );
  if (!payerMsisdn) {
    throw new ValidationError({
      mtnMomoPhone: [
        "A valid MTN mobile money number is required for MTN MoMo",
      ],
    });
  }

  // The X-Reference-Id is minted here and never returned by MTN — it is
  // the transaction's only handle, so it must be on the order before the
  // prompt can exist anywhere.
  const mtnMomoReferenceId = randomUUID();

  // Like ioTec (and unlike Orange Money), the order is persisted first and
  // cancelled if the request never starts: requesttopay puts a PIN prompt
  // on the payer's phone straight away, and a prompt whose reference we
  // failed to store is money that could move with no order behind it.
  const order = await createOrder({
    ...checkoutDetails,
    storeCredit: orderStoreCredit,
    customerId,
    guestEmail,
    items,
    shippingAddress: normalizedShippingAddress,
    digitalOnly,
    billingAddress: normalizedBillingAddress,
    paymentMethod: "mtn_momo",
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
    mtnMomoReferenceId,
    mtnMomoPhone: payerMsisdn,
    isMultiVendorEnabled,
    orderPrefix: orderSettings.prefix,
    currency,
    idempotencyKey: options.idempotencyKey,
  });

  // The provider has accepted nothing yet, but it is about to put a PIN
  // prompt on the payer's phone — and once it does, these providers cannot
  // refund a sold-out order automatically. So the goods come off the shelf
  // now, with the order, the way Shopify holds stock for a pending
  // payment. `settleCapturedOrder` sees the consignments already flagged
  // and does not take them a second time.
  const mtnSoldOut = await reserveAsyncPushInventory({
    order,
    items,
    inventoryOpts: pickupFulfillment
      ? { locationId: pickupFulfillment.pickup.pickupLocationId }
      : {},
  });
  if (mtnSoldOut) {
    await retireRefusedGatewayOrder({
      orderId: order._id,
      orderNumber: order.orderNumber,
      cartId: cart?._id,
      paymentMethod: "mtn_momo",
      amount: paymentDueNow,
      currency,
      reason: "out_of_stock",
    });
    const failedItem = items.find(
      (item) => String(item.productId._id) === mtnSoldOut.soldOutProductId,
    );
    throw new ValidationError({
      stock: [
        `${failedItem?.productId.name || "Product"} is out of stock or has insufficient quantity`,
      ],
    });
  }

  try {
    await requestMtnMomoPayment({
      creds: mtnMomoCreds,
      referenceId: mtnMomoReferenceId,
      amount: paymentDueNow,
      // Sandbox settles in EUR only, live in the store's own currency.
      // One helper decides, and the finalizer reads the same.
      currency: mtnMomoChargeCurrency(mtnMomoCreds.mode, currency),
      // Echoed back by the status endpoint and shown in MTN's dashboard —
      // the order id makes it directly searchable in the admin.
      externalId: String(order._id),
      payerMsisdn,
      payerMessage: `Order ${order.orderNumber}`.replace(/[^\w\s.-]/g, ""),
      payeeNote: `Store checkout ${order._id}`,
      // Built from the host registered with MTN, not from this request's
      // origin: MTN compares the two and fails the whole payment with
      // INVALID_CALLBACK_URL_HOST when they differ. Unconfigured means no
      // callback is requested at all, which costs only an optimistic
      // notification the finalizer never trusts on its own.
      callbackUrl: mtnMomoCallbackUrl(mtnMomoCreds),
    });
  } catch (err) {
    // Retire the order ONLY when MTN definitively refused the request. A
    // 4xx is a rejected payload — nothing was queued and no phone was
    // prompted, so the order can never be paid. A timeout or a 5xx is
    // ambiguous: MTN may have accepted it and prompted the payer anyway,
    // and cancelling there would strand real money against a cancelled
    // order that the finalizer then refuses forever. Left PENDING it is
    // just an abandoned checkout — this gateway's normal resting state —
    // and the reconcile sweep completes it if the payer did pay.
    const definitivelyRejected =
      err instanceof MtnMomoApiError &&
      err.httpStatus >= 400 &&
      err.httpStatus < 500;
    if (definitivelyRejected) {
      await retireRefusedGatewayOrder({
        orderId: order._id,
        orderNumber: order.orderNumber,
        cartId: cart?._id,
        paymentMethod: "mtn_momo",
        amount: paymentDueNow,
        currency,
        error: err,
      });
    } else {
      console.error(
        `MTN MoMo requesttopay outcome unknown for order ${order._id}; left pending for the reconcile sweep:`,
        err,
      );
    }
    throw err;
  }

  return { order, referenceId: mtnMomoReferenceId, payerMsisdn };
}
