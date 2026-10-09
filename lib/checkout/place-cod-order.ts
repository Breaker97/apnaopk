import "server-only";
import { after } from "next/server";
import { afterResponse } from "@/lib/after-response";
import { Cart } from "@/models";
import { PAYMENT_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { sendOrderConfirmationEmail } from "@/lib/email/order-emails";
import {
  decrementInventory,
  InsufficientStockError,
  restoreInventory,
} from "@/lib/inventory/inventory";
import { markOrderInventoryReserved } from "@/lib/orders/order-inventory";
import { releaseCouponUse, takeCouponUse } from "@/lib/catalog/coupons";
import { readSubOrderVendors } from "@/lib/orders/order-vendors";
import { ensurePendingChargeTransaction } from "@/lib/payments/payment-transactions";
import { markCheckoutRecovered } from "@/lib/orders/abandoned-checkouts";
import { notifyOrderCreatedParticipants } from "@/lib/notifications/notifications";
import { assertCashOnDeliveryAllowed } from "@/lib/checkout/cod-eligibility";
import {
  claimCartForOrder,
  createOrder,
} from "@/lib/checkout/checkout-order-document";
import type { CheckoutDraft } from "@/lib/checkout/prepare-checkout";
import type { AuditContext } from "@/lib/audit";
import { auditOrderPlaced } from "@/lib/orders/audit-order";

/**
 * Place a cash-on-delivery order from a prepared checkout
 * (`prepareCheckout(…, { mode: "place" })`): nothing is charged, so the order
 * is the commitment — the coupon's use is taken, the stock moves, the order
 * is written and the cart emptied in this request, and the bookkeeping, the
 * confirmation email and the notifications follow the answer.
 *
 * Moved here from app/api/payments/checkout/route.ts, which answers with
 * what this returns; so does the shopper app's POST /checkout/orders, which
 * stamps the order with its `idempotencyKey` (one order per key: the order
 * model's unique index refuses a second).
 *
 * Both callers share this function, so the order's "placed" row is written
 * here, once, and not by either of them: it follows the order's creation, and
 * an attempt that loses the idempotency race never reaches it.
 */
export async function placeCodOrder(
  draft: CheckoutDraft,
  options: {
    idempotencyKey?: string;
    /** Who placed it and from where: the web's request, or the app's origin. */
    audit: AuditContext;
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
    hasPreorder,
    hasDigitalItems,
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
    itemVendorId,
    checkoutUrl,
    codSnapshotWritten,
    checkoutCouponHoldKey,
    orderStoreCredit,
  } = draft;
  const codSettings = settings.payment?.cod;

  assertCashOnDeliveryAllowed({
    settings: codSettings,
    total,
    hasDigitalItems,
    hasPreorder,
  });
  // One order per cart — see `claimCartForOrder`.
  const releaseCartClaim = await claimCartForOrder(cart._id);

  // The order is the commitment, so the coupon's use is taken now — and
  // refused now if it has none — rather than counted once the order exists.
  if (appliedCoupon) {
    try {
      await takeCouponUse({
        couponId: appliedCoupon.couponId,
        holdKey: checkoutCouponHoldKey,
      });
    } catch (err) {
      await releaseCartClaim();
      throw err;
    }
  }
  const giveBackCouponUse = () =>
    appliedCoupon
      ? releaseCouponUse(appliedCoupon.couponId).catch((err) =>
          console.error("Failed to give back a COD coupon use:", err),
        )
      : Promise.resolve();

  // The sellers' commission and COD records the order's consignments are
  // built from, read while the stock moves rather than after it.
  const subOrderVendors = isMultiVendorEnabled
    ? readSubOrderVendors(
        Array.from(new Set(items.map(itemVendorId).filter(Boolean))),
      )
    : undefined;
  subOrderVendors?.catch(() => undefined);
  // Where the stock landed, the storefront refresh and low-stock alerts:
  // run alongside the order's creation and waited for before the answer —
  // or, should the order fail first, finished after it.
  let stockAftermath: Promise<void> | undefined;

  // Every line is a standard purchase here — the pre-order guard above
  // keeps reservation-type lines off the COD path entirely.
  const inventoryLines = items.map((item) => ({
    productId: String(item.productId._id),
    variantId: item.variantId,
    quantity: item.quantity,
  }));

  try {
    // A collection comes off the counter the shopper chose, not off
    // whichever branch happens to hold the most. The order does not exist
    // yet on this path, so the snapshot is read directly rather than
    // through `orderInventoryOpts`.
    await decrementInventory(inventoryLines, {
      ...(pickupFulfillment
        ? { locationId: pickupFulfillment.pickup.pickupLocationId }
        : {}),
      onAftermath: (aftermath) => {
        const settled = aftermath.catch((err) =>
          console.error("Failed to finish a COD stock movement:", err),
        );
        stockAftermath = settled;
        afterResponse(() => settled);
      },
    });
  } catch (err) {
    await giveBackCouponUse();
    await releaseCartClaim();
    if (err instanceof InsufficientStockError) {
      const failedItem = items.find(
        (item) => String(item.productId._id) === String(err.line.productId),
      );
      const failedName = failedItem?.productId.name || "Product";
      throw new ValidationError({
        stock: [
          `${failedName} is out of stock or has insufficient quantity`,
        ],
      });
    }
    throw err;
  }

  let order: Awaited<ReturnType<typeof createOrder>>;
  try {
    order = await createOrder({
      ...checkoutDetails,
      storeCredit: orderStoreCredit,
      customerId,
      guestEmail,
      items,
      shippingAddress: normalizedShippingAddress,
    digitalOnly,
      billingAddress: normalizedBillingAddress,
      paymentMethod: "cod",
      couponUseTaken: Boolean(appliedCoupon),
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
      isMultiVendorEnabled,
      subOrderVendors,
      orderPrefix: orderSettings.prefix,
      currency: settings.general?.defaultCurrency || "USD",
      idempotencyKey: options.idempotencyKey,
    });
  } catch (err) {
    // Back to the branch the decrement just took them from — the same
    // options object, or the units migrate between shops on every failed
    // order creation.
    await restoreInventory(
      inventoryLines,
      pickupFulfillment
        ? { locationId: pickupFulfillment.pickup.pickupLocationId }
        : {},
    ).catch(() => undefined);
    await giveBackCouponUse();
    await releaseCartClaim();
    throw err;
  }

  // A guest has no account to name, and a row with no actor reads "by System"
  // in the timeline: the email they checked out with is who placed it.
  const placedBy: AuditContext =
    options.audit.userEmail || !customerEmail
      ? options.audit
      : { ...options.audit, userEmail: customerEmail };

  // Mark sub-orders as having inventory reserved so cancel/refund paths
  // know which lines to restore — and clear the cart, which waits only on
  // the order and the inventory having succeeded. Independent, so together,
  // with the snapshot and the stock follow-up started earlier, and the
  // order's birth event, which needs nothing but the order. The cart is
  // emptied and its claim released in one write: the empty cart is what
  // refuses a late duplicate from here on.
  await Promise.all([
    markOrderInventoryReserved(String(order._id)).catch((err) =>
      console.error("Failed to mark inventory reserved on COD order:", err),
    ),
    Cart.findByIdAndUpdate(cart._id, {
      $set: { items: [] },
      $unset: { checkoutClaimedAt: "" },
    }),
    codSnapshotWritten,
    stockAftermath,
    auditOrderPlaced(placedBy, order, {
      source: "storefront",
      total: order.total,
      currency: order.currency || settings.general?.defaultCurrency,
      itemCount: order.items.length,
      paymentMethod: order.paymentMethod,
    }),
  ]);

  // Bookkeeping, confirmation email (PDF invoice + SMTP), and
  // notifications run after the response streams so the customer
  // isn't held on the success redirect while they complete.
  after(async () => {
    await ensurePendingChargeTransaction({
      _id: String(order._id),
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentId: order.paymentId,
      stripePaymentIntentId: order.stripePaymentIntentId,
      paypalCaptureId: order.paypalCaptureId,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      tax: order.tax,
      discount: order.discount,
      total: order.total,
      currency: settings.general?.defaultCurrency,
      channel: "online",
      createdAt: order.createdAt,
      storeCredit: order.storeCredit ?? null,
    }).catch((err) => {
      console.error("Failed to sync pending COD payment transaction:", err);
    });

    await markCheckoutRecovered({
      cartId: cart._id,
      orderId: order._id,
      total: order.total,
      paymentEvent: {
        gateway: "cod",
        status: "succeeded",
        message: "Cash on delivery order placed",
      },
    }).catch((err) =>
      console.error("Failed to mark abandoned checkout recovered:", err),
    );

    if (customerEmail) {
      await sendOrderConfirmationEmail(
        {
          orderNumber: order.orderNumber,
          customerName: normalizedShippingAddress.fullName,
          customerEmail,
          items: order.items.map(
            (i: {
              name: string;
              quantity: number;
              price: number;
              image?: string;
            }) => ({
              name: i.name,
              quantity: i.quantity,
              price: i.price,
              image: i.image,
            }),
          ),
          subtotal: order.subtotal,
          discount: order.discount,
          shipping: order.shippingCost,
          tax: order.tax,
          total: order.total,
          shippingAddress: order.shippingAddress,
          paymentMethod: order.paymentMethod,
        },
        settings,
      ).catch((err) =>
        console.error("Failed to send COD order confirmation email:", err),
      );
    }

    await notifyOrderCreatedParticipants(order, {
      customerEmailSent: Boolean(customerEmail),
    }).catch((err) =>
      console.error("Failed to create COD order notifications:", err),
    );
  });

  return {
    order,
    data: {
      orderId: order._id,
      orderNumber: order.orderNumber,
      paymentMethod: "cod" as const,
      redirectUrl: `${checkoutUrl("/checkout/success")}?order=${order.orderNumber}`,
    },
  };
}
