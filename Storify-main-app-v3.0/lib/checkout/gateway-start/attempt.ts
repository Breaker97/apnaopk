import "server-only";
import { CHECKOUT_ATTEMPT_STATUS } from "@/models";
import { PAYMENT_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { normalizeCheckoutSettings } from "@/lib/checkout/checkout-config";
import {
  closeCheckoutAttempt,
  openCheckoutAttempt,
} from "@/lib/checkout/checkout-attempt-store";
import { buildOrderDocument } from "@/lib/checkout/checkout-order-document";
import type { CheckoutDraft } from "@/lib/checkout/prepare-checkout";

/**
 * What every gateway's start shares: the order a checkout would write, and the
 * checkout attempt that stands in for it on a gateway switched over to
 * attempts (`isAttemptGateway`, lib/payments/attempt-gateways.ts).
 *
 * Moved here from app/api/payments/checkout/route.ts with the redirect
 * gateways' starts (this folder), which the website's checkout and the
 * shopper app's POST /checkout/redirect both run.
 */

/** Where the checkout request came from, for the attempt's record. */
export interface GatewayStartRequest {
  /** `getClientIP`'s answer, "unknown" when there is none. */
  clientIp: string;
  userAgent?: string;
}

/**
 * Everything an order document needs except the gateway's own part, so a
 * checkout attempt's snapshot is built from exactly what a pre-created
 * order would have been. Each gateway spreads it and adds `paymentMethod`
 * and its own references.
 *
 * The legacy `createOrder` calls of the order-first starts still spell this
 * out inline; they go away as each gateway is switched over, and changing
 * both shapes at once would be a large diff across every gateway for no gain.
 */
export function orderDocumentParams(draft: CheckoutDraft) {
  const {
    settings,
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
    attemptFields,
    orderStoreCredit,
  } = draft;
  return {
    ...checkoutDetails,
    storeCredit: orderStoreCredit,
    customerId,
    guestEmail,
    items,
    shippingAddress: normalizedShippingAddress,
    digitalOnly,
    billingAddress: normalizedBillingAddress,
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
    ...attemptFields,
    isMultiVendorEnabled,
    orderPrefix: orderSettings.prefix,
    currency: settings.general?.defaultCurrency || "USD",
  };
}

/**
 * Open an attempt for this cart on a gateway that has been switched over,
 * and hold its goods for the payment window.
 *
 * The hold is what keeps two shoppers from both paying for the last unit
 * while each is away at a gateway — the one failure a redirect gateway
 * cannot undo gracefully. It lapses on its own clock, long before the
 * attempt does; see `lib/checkout/attempt-stock-hold.ts`.
 */
export async function openGatewayAttempt(
  draft: CheckoutDraft,
  method: string,
  request: GatewayStartRequest,
  gatewayFields: Record<string, unknown> = {},
) {
  const {
    settings,
    cart,
    items,
    customerId,
    guestEmail,
    hasPreorder,
    pickupFulfillment,
    attemptFingerprint,
  } = draft;
  const attempt = await openCheckoutAttempt({
    snapshot: await buildOrderDocument({
      ...orderDocumentParams(draft),
      paymentMethod: method,
      ...gatewayFields,
    }),
    paymentMethod: method,
    cartId: cart._id,
    checkoutToken: cart.checkoutToken,
    customerId,
    guestEmail,
    sessionId: cart.sessionId,
    fingerprint: attemptFingerprint,
    clientIp: request.clientIp,
    userAgent: request.userAgent,
  });

  const holdSettings = normalizeCheckoutSettings(settings.checkout).stockHold;
  // A pre-order holds quota, not stock, and that quota is taken by the
  // path that owns it (`reservePreorderQuantity`).
  if (holdSettings.enabled && !hasPreorder) {
    const { holdAttemptStock } = await import(
      "@/lib/checkout/attempt-stock-hold"
    );
    const soldOut = await holdAttemptStock({
      attemptId: attempt._id,
      items,
      minutes: holdSettings.minutes,
      inventoryOpts: pickupFulfillment
        ? { locationId: pickupFulfillment.pickup.pickupLocationId }
        : {},
    });
    if (soldOut) {
      // Nothing was taken (the decrement rolls its own partial work
      // back), and the attempt is closed rather than left holding a
      // gateway session for goods that are gone.
      await abandonAttempt(attempt._id);
      const failedItem = items.find(
        (item) => String(item.productId._id) === soldOut.soldOutProductId,
      );
      throw new ValidationError({
        stock: [
          `${failedItem?.productId.name || "Product"} is out of stock or has insufficient quantity`,
        ],
      });
    }
  }

  return attempt;
}

/**
 * Close an attempt whose gateway never gave it a session.
 *
 * Without this the attempt sits open holding the shopper's goods until the
 * hold sweep comes round — a quarter of an hour of a shop being short of
 * stock because a payment provider answered with an error. Nothing can
 * ever be paid against it either: no reference was recorded, so no
 * finalizer could find it.
 */
async function abandonAttempt(attemptId: unknown) {
  await closeCheckoutAttempt(
    attemptId,
    CHECKOUT_ATTEMPT_STATUS.SUPERSEDED,
  ).catch((error) =>
    console.error(
      "Failed to close a checkout attempt the gateway refused:",
      error,
    ),
  );
}

/** Run the gateway's own call, closing the attempt if it refuses. */
export async function withAttempt<T>(
  attemptId: unknown,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    await abandonAttempt(attemptId);
    throw error;
  }
}
