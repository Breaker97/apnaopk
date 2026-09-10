/**
 * Stripe Checkout metadata binding for product-boost purchases. Mirrors
 * lib/vendor-checkout-binding.ts: the metadata `kind` is how the shared
 * Stripe webhook tells a boost session apart from vendor-application and
 * order sessions.
 */

import type Stripe from "stripe";

export const PRODUCT_BOOST_CHECKOUT_KIND = "product_boost";

export function buildBoostCheckoutMetadata(input: {
  paymentId: string;
  campaignId: string;
  vendorId: string;
  userId: string;
  productId: string;
  positionId: string;
}): Record<string, string> {
  return {
    kind: PRODUCT_BOOST_CHECKOUT_KIND,
    paymentId: input.paymentId,
    campaignId: input.campaignId,
    vendorId: input.vendorId,
    userId: input.userId,
    productId: input.productId,
    positionId: input.positionId,
  };
}

export function isBoostCheckoutSession(
  session: Stripe.Checkout.Session,
): boolean {
  return session.metadata?.kind === PRODUCT_BOOST_CHECKOUT_KIND;
}
