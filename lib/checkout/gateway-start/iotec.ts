import "server-only";
import { Order } from "@/models";
import { PAYMENT_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { createOrder } from "@/lib/checkout/checkout-order-document";
import type { CheckoutDraft } from "@/lib/checkout/prepare-checkout";
import { reserveAsyncPushInventory } from "@/lib/orders/async-push-inventory";
import { retireRefusedGatewayOrder } from "@/lib/orders/refused-gateway-order";
import { storeCurrencyCode } from "@/lib/payments/gateway-currencies";
import {
  getIotecCredentials,
  IOTEC_MIN_AMOUNT,
  IotecApiError,
  normalizeUgandaMsisdn,
  submitIotecCardCollection,
  submitIotecCollection,
  type IotecCollectionResponse,
} from "@/lib/payments/iotec";
import { resolveIotecCredentials } from "@/lib/settings/credentials";

/**
 * Start an ioTec payment from a prepared checkout
 * (`prepareCheckout(…, { mode: "place" })`): the order is written pending and
 * its goods held, then ioTec is asked — a PIN prompt on the payer's phone
 * (mobile money), or a hosted card page (card).
 *
 * Moved here from app/api/payments/checkout/route.ts, which answers with what
 * this returns; so does the shopper app's POST /checkout/push, which stamps
 * the order with its `idempotencyKey`. Where ioTec's card page sends the payer
 * back is the caller's: the website's success page, or the app's return
 * bridge.
 *
 * Throws `IotecApiError` when ioTec answered with an error, after retiring
 * the order only if that answer was a definitive refusal (a 4xx); any other
 * failure leaves the order pending, because the collection may have started.
 */
export async function startIotecPayment(
  draft: CheckoutDraft,
  options: {
    channel?: "mobile_money" | "card";
    /** The mobile-money number; the billing phone when left out. */
    phone?: string;
    /** Where ioTec's hosted card page returns the payer, given the external id. */
    cardReturnUrl?: (externalId: string) => string;
    idempotencyKey?: string;
  },
) {
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
    orderStoreCredit,
  } = draft;
  const iotecSettings = settings.payment?.iotec;

  if (!iotecSettings?.enabled) {
    throw new ValidationError("ioTec Pay is disabled");
  }

  const resolvedIotec = resolveIotecCredentials(iotecSettings);
  const iotecCreds = getIotecCredentials(resolvedIotec);
  if (!iotecCreds.walletId) {
    throw new ValidationError(
      "ioTec Pay is not configured. Add the wallet ID in Admin → Settings → Payments.",
    );
  }

  // Shillings: ioTec settles UGX alone, and the gate in `prepareCheckout` has
  // already turned away a store priced in anything else — which is also what
  // keeps the minimum below in the unit it is written in.
  const currency = storeCurrencyCode(settings);
  // ioTec collections take whole currency units (UGX is zero-decimal).
  const amount = Math.round(paymentDueNow);
  if (amount < IOTEC_MIN_AMOUNT) {
    throw new ValidationError(
      `ioTec Pay requires a minimum amount of ${IOTEC_MIN_AMOUNT} ${currency}.`,
    );
  }

  const externalId = `iot-${String(cart._id).slice(-18)}-${Date.now().toString(36)}`;
  const isCard = options.channel === "card";
  const cardReturnUrl = options.cardReturnUrl;
  if (isCard && !cardReturnUrl) {
    throw new Error("An ioTec card payment needs a return URL");
  }
  // Card collections are billed to the customer's email; mobile money is
  // billed to the MSISDN the payer approves the PIN prompt on.
  const payer = isCard
    ? String(customerEmail || "")
    : normalizeUgandaMsisdn(options.phone || normalizedBillingAddress.phone);
  if (!payer) {
    throw new ValidationError(
      isCard
        ? { email: ["Email is required for ioTec card payments"] }
        : {
            iotecPhone: [
              "A valid Ugandan mobile money number is required for ioTec Pay",
            ],
          },
    );
  }

  // Submitting a mobile-money collection puts a PIN prompt on the payer's
  // phone straight away, and ioTec has no programmatic refund API. So the
  // order is persisted first and cancelled if the collection never starts —
  // the reverse order could take a payment with no order behind it.
  const order = await createOrder({
    ...checkoutDetails,
    storeCredit: orderStoreCredit,
    customerId,
    guestEmail,
    items,
    shippingAddress: normalizedShippingAddress,
    digitalOnly,
    billingAddress: normalizedBillingAddress,
    paymentMethod: "iotec",
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
    iotecExternalId: externalId,
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
  const iotecSoldOut = await reserveAsyncPushInventory({
    order,
    items,
    inventoryOpts: pickupFulfillment
      ? { locationId: pickupFulfillment.pickup.pickupLocationId }
      : {},
  });
  if (iotecSoldOut) {
    await retireRefusedGatewayOrder({
      orderId: order._id,
      orderNumber: order.orderNumber,
      cartId: cart?._id,
      paymentMethod: "iotec",
      amount: paymentDueNow,
      currency,
      reason: "out_of_stock",
    });
    const failedItem = items.find(
      (item) => String(item.productId._id) === iotecSoldOut.soldOutProductId,
    );
    throw new ValidationError({
      stock: [
        `${failedItem?.productId.name || "Product"} is out of stock or has insufficient quantity`,
      ],
    });
  }

  let collection: IotecCollectionResponse;
  try {
    collection = isCard
      ? await submitIotecCardCollection({
          creds: iotecCreds,
          externalId,
          currency,
          amount,
          payer,
          redirectUrl: cardReturnUrl!(externalId),
          payerName: normalizedBillingAddress.fullName,
          payerNote: `Store checkout ${externalId}`,
        })
      : await submitIotecCollection({
          creds: iotecCreds,
          externalId,
          currency,
          amount,
          payer,
          payerName: normalizedBillingAddress.fullName,
          payerNote: `Store checkout ${externalId}`,
        });

    if (!collection.id || (isCard && !collection.cardRedirectUrl)) {
      throw new ValidationError(
        isCard
          ? "ioTec returned an invalid card response"
          : "ioTec returned an invalid collection response",
      );
    }
  } catch (err) {
    // Retire the order only when ioTec definitively refused the request —
    // the rule MTN MoMo keeps too (./mtn-momo.ts). A 4xx means nothing was
    // queued and no phone was prompted. A timeout, a dropped connection, a 5xx
    // or an unreadable 2xx may all be a collection ioTec accepted: the payer
    // approves the PIN, and a cancelled order would be refunded rather than
    // fulfilled. Left pending it is an abandoned checkout, and the callback
    // (which carries the external id) settles it if the payer did pay.
    const definitivelyRejected =
      err instanceof IotecApiError &&
      err.httpStatus >= 400 &&
      err.httpStatus < 500;
    if (definitivelyRejected) {
      await retireRefusedGatewayOrder({
        orderId: order._id,
        orderNumber: order.orderNumber,
        cartId: cart?._id,
        paymentMethod: "iotec",
        amount: paymentDueNow,
        currency,
        error: err,
      });
    } else {
      console.error(
        `ioTec collection outcome unknown for order ${order._id}; left pending for its callback:`,
        err,
      );
    }
    throw err;
  }

  // The finalizer looks orders up by transaction id; until this lands it
  // falls back to the external id the callback also carries.
  await Order.updateOne(
    { _id: order._id },
    { $set: { iotecTransactionId: collection.id } },
  );

  return {
    order,
    externalId,
    transactionId: collection.id,
    /** ioTec's hosted card page, for the card channel. */
    cardRedirectUrl: isCard ? collection.cardRedirectUrl : undefined,
  };
}
