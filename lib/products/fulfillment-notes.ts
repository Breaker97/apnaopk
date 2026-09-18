/**
 * What the product page's "Delivery info" card can honestly promise.
 *
 * The card used to print "Standard delivery within 2–5 business days" and
 * "Return items in original condition for a full refund" on every product of
 * every store — copy, not data — so a store shipping in ten days, or one
 * charging a restocking fee, was contradicted by its own product page. Both
 * lines now come from the settings that checkout and the return flow actually
 * enforce, and a line with nothing true to say is left out rather than filled
 * with a guess.
 *
 * Client-safe and pure. The server composer (product-fulfillment-notes.ts)
 * gathers the inputs; the buy box turns the result into sentences.
 */

type ProductDeliveryWindow = { min: number; max: number };

type ProductReturnsNote = {
  /** Days after delivery within which a return may be requested. */
  windowDays: number;
  /** 0–100; 0 means the goods are refunded in full. */
  restockingFeePercent: number;
  /** Flat return-shipping charge deducted from the refund; 0 when none. */
  returnShippingFee: number;
  /** The store's return policy page is published, so the line can link to it. */
  policyPage: boolean;
};

export type ProductFulfillmentNotes = {
  /** `null` when no delivery window can be promised. */
  deliveryDays: ProductDeliveryWindow | null;
  /** `null` when the product cannot be returned in the ordinary sense. */
  returns: ProductReturnsNote | null;
};

/**
 * The window of the shipping option checkout would preselect (cheapest,
 * fastest on a tie), or nothing.
 *
 * Nothing when the merchant switched estimates off (`showEstimatedDelivery`,
 * the same consent the cart and checkout ask for), when the store cannot ship
 * the item at all, and when the option carries no days — the admin form
 * stores 0/0 for a rate nobody gave a window to, and the cart estimator
 * already reads that as "no promise" rather than "same day".
 */
export function deliveryWindowFromShipping(params: {
  available: boolean;
  method?: { minDays?: number; maxDays?: number } | null;
  showEstimatedDelivery: boolean;
}): ProductDeliveryWindow | null {
  if (!params.showEstimatedDelivery || !params.available) return null;
  const min = Number(params.method?.minDays);
  const max = Number(params.method?.maxDays);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return null;
  return { min: Math.max(0, min), max: Math.max(min, max) };
}

/**
 * The return terms in force, or nothing for an item that has no "original
 * condition" to come back in — a download is delivered the moment it is paid
 * for, and the policy page lists digital goods among its exclusions.
 */
export function returnsNoteFromPolicy(params: {
  requiresShipping: boolean;
  policy: {
    windowDays: number;
    restockingFeePercent: number;
    returnShippingFee: number;
  };
  policyPage: boolean;
}): ProductReturnsNote | null {
  if (!params.requiresShipping) return null;
  const windowDays = Number(params.policy.windowDays);
  if (!Number.isFinite(windowDays) || windowDays <= 0) return null;
  return {
    windowDays,
    restockingFeePercent: Math.max(0, params.policy.restockingFeePercent || 0),
    returnShippingFee: Math.max(0, params.policy.returnShippingFee || 0),
    policyPage: params.policyPage,
  };
}
