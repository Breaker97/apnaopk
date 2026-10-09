import "server-only";
import { Order } from "@/models";
import { PAYMENT_STATUS } from "@/config/app.config";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { ValidationError } from "@/lib/api/errors";
import { createOrder } from "@/lib/checkout/checkout-order-document";
import type { CheckoutDraft } from "@/lib/checkout/prepare-checkout";
import { currencyMinorUnitExponent } from "@/lib/intl/money";
import { reserveAsyncPushInventory } from "@/lib/orders/async-push-inventory";
import { retireRefusedGatewayOrder } from "@/lib/orders/refused-gateway-order";
import { storeCurrencyCode } from "@/lib/payments/gateway-currencies";
import {
  getOrangeMoneyCredentials,
  orangeMoneyChargeCurrency,
  orangeMoneyLang,
  submitOrangeMoneyPayment,
} from "@/lib/payments/orange-money";
import { resolveOrangeMoneyCredentials } from "@/lib/settings/credentials";
import type { GatewayCheckoutRecord } from "./types";

export interface OrangeMoneyCheckoutStart {
  record: GatewayCheckoutRecord;
  /** Our reference, which Orange calls `order_id`. */
  orangeMoneyOrderId: string;
  /** Orange's hosted page, where the payer enters the OTP. */
  paymentUrl: string;
}

/**
 * Start paying for a prepared checkout with Orange Money: the pending order,
 * its goods taken off the shelf, and a web payment on Orange's hosted page.
 * Always order first: Orange's notification is keyed on our own reference.
 *
 * `returnUrl` builds where Orange sends the payer back from our reference,
 * and `cancelUrl` is where a payer who gives up goes: the website's pages, or
 * the shopper app's return bridge. Orange adds nothing to either.
 */
export async function startOrangeMoneyCheckout(
  draft: CheckoutDraft,
  options: { returnUrl: (orangeMoneyOrderId: string) => string; cancelUrl: string },
): Promise<OrangeMoneyCheckoutStart> {
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
    origin,
    orderStoreCredit,
  } = draft;
  const orangeMoneySettings = settings.payment?.orange_money;

  if (!orangeMoneySettings?.enabled) {
    throw new ValidationError("Orange Money is disabled");
  }
  if (!customerEmail) {
    throw new ValidationError({
      email: ["Email is required for Orange Money checkout"],
    });
  }

  const resolvedOrangeMoney =
    resolveOrangeMoneyCredentials(orangeMoneySettings);
  const orangeMoneyCreds = getOrangeMoneyCredentials(resolvedOrangeMoney);

  // One the wallet settles — prepareCheckout's currency gate turned away any
  // other.
  const currency = storeCurrencyCode(settings);

  // A fully-discounted cart has nothing for a wallet to collect, and Orange
  // answers a zero-amount web payment with an error the shopper cannot act
  // on. Say so here instead, before an order is written and cancelled.
  if (!(paymentDueNow > 0)) {
    throw new ValidationError(
      "This order has nothing left to pay. Place it without a payment gateway.",
    );
  }

  // Orange takes major units. In a zero-decimal currency a fractional total
  // would be silently rounded by the gateway and then fail the finalizer's
  // cross-check — after the payer's money had moved.
  if (
    currencyMinorUnitExponent(currency) === 0 &&
    !Number.isInteger(paymentDueNow)
  ) {
    throw new ValidationError(
      `${currency} has no minor unit, so ${paymentDueNow} cannot be charged. Round the cart total to a whole ${currency}.`,
    );
  }

  const orangeMoneyOrderId = `om-${String(cart._id).slice(-18)}-${Date.now().toString(36)}`;

  // The order is written BEFORE the gateway call on purpose. Orange's
  // notification is keyed on our own reference, so persisting it first means
  // the callback's lookup key exists from the very first moment — no
  // adoption path, no second write for a notification to outrun. Creating an
  // unpaid order early is safe here because /webpayment only mints a hosted
  // URL: it moves no money and prompts nobody.
  const order = await createOrder({
    ...checkoutDetails,
    storeCredit: orderStoreCredit,
    customerId,
    guestEmail,
    items,
    shippingAddress: normalizedShippingAddress,
    digitalOnly,
    billingAddress: normalizedBillingAddress,
    paymentMethod: "orange_money",
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
    orangeMoneyOrderId,
    isMultiVendorEnabled,
    orderPrefix: orderSettings.prefix,
    currency,
  });

  // The provider has accepted nothing yet, but it is about to put a PIN
  // prompt on the payer's phone — and once it does, these providers cannot
  // refund a sold-out order automatically. So the goods come off the shelf
  // now, with the order, the way Shopify holds stock for a pending
  // payment. `settleCapturedOrder` sees the consignments already flagged
  // and does not take them a second time.
  const orangeSoldOut = await reserveAsyncPushInventory({
    order,
    items,
    inventoryOpts: pickupFulfillment
      ? { locationId: pickupFulfillment.pickup.pickupLocationId }
      : {},
  });
  if (orangeSoldOut) {
    await retireRefusedGatewayOrder({
      orderId: order._id,
      orderNumber: order.orderNumber,
      cartId: cart?._id,
      paymentMethod: "orange_money",
      amount: paymentDueNow,
      currency,
      reason: "out_of_stock",
    });
    const failedItem = items.find(
      (item) => String(item.productId._id) === orangeSoldOut.soldOutProductId,
    );
    throw new ValidationError({
      stock: [
        `${failedItem?.productId.name || "Product"} is out of stock or has insufficient quantity`,
      ],
    });
  }

  let payment;
  try {
    payment = await submitOrangeMoneyPayment({
      creds: orangeMoneyCreds,
      orderId: orangeMoneyOrderId,
      amount: paymentDueNow,
      // Sandbox settles in Orange's placeholder currency, live in the
      // store's own. One helper decides, and the finalizer reads the same.
      currency: orangeMoneyChargeCurrency(orangeMoneyCreds.mode, currency),
      returnUrl: options.returnUrl(orangeMoneyOrderId),
      cancelUrl: options.cancelUrl,
      // Orange calls this server-to-server, so it must be absolute and
      // publicly reachable — not a locale-prefixed page route.
      notifUrl: `${origin}/api/payments/orange-money/callback`,
      lang: orangeMoneyLang(activeLocale),
      reference: settings.general?.storeName || DEFAULT_STORE_NAME,
    });
  } catch (err) {
    // Nothing was charged, but an order with no payment session behind it
    // can never be completed — retire it rather than leaving it pending.
    await retireRefusedGatewayOrder({
      orderId: order._id,
      orderNumber: order.orderNumber,
      cartId: cart?._id,
      paymentMethod: "orange_money",
      amount: paymentDueNow,
      currency,
      error: err,
    });
    throw err;
  }

  // The pay token is required to call /transactionstatus and the notif
  // token is the only secret the callback can authenticate against, so an
  // order without them can never be verified. Losing this write is fatal.
  const stored = await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        orangeMoneyPayToken: payment.pay_token,
        orangeMoneyNotifToken: payment.notif_token,
      },
    },
  );
  if (stored.modifiedCount !== 1) {
    await retireRefusedGatewayOrder({
      orderId: order._id,
      orderNumber: order.orderNumber,
      cartId: cart?._id,
      paymentMethod: "orange_money",
      amount: paymentDueNow,
      currency,
      reason: "session_not_stored",
    });
    throw new ValidationError(
      "Orange Money payment session could not be stored. Please try again.",
    );
  }

  return {
    record: { kind: "order", id: order._id, orderNumber: order.orderNumber },
    orangeMoneyOrderId,
    paymentUrl: payment.payment_url,
  };
}
