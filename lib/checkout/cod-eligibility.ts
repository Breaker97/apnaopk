import { ValidationError } from "@/lib/api/errors";

export type CashOnDeliverySettings = {
  enabled?: boolean;
  minOrderAmount?: number;
  maxOrderAmount?: number;
};

/**
 * Refuse a cash-on-delivery order the store's settings do not allow.
 *
 * One copy for every route that creates a COD order. The storefront checkout
 * enforced these rules while the older direct-order endpoint enforced only the
 * digital one, so a shopper posting there placed COD orders the store had
 * switched off, or larger than it lets a courier carry cash for.
 */
export function assertCashOnDeliveryAllowed(params: {
  settings?: CashOnDeliverySettings | null;
  /** What the courier collects, duty included. */
  total: number;
  hasDigitalItems: boolean;
  hasPreorder?: boolean;
}): void {
  const { settings, total } = params;
  if (settings?.enabled === false) {
    throw new ValidationError("Cash on Delivery is disabled");
  }
  // Digital deliverables release off the order itself, not off a courier
  // hand-over, so any digital line on a COD order would be handed over before
  // a single unit of cash changes hands — on a downloads-only order the money
  // never has a moment to be collected at all, and on a mixed order the
  // shopper can keep the files and refuse the parcel. Checkout keeps COD off
  // the screen for these carts; this is the backstop.
  if (params.hasDigitalItems) {
    throw new ValidationError(
      "Cash on Delivery is not available for orders that include digital items",
    );
  }
  // A pre-order commits the seller's stock at reservation time, and its
  // deposit/pay-later maths assume money moves NOW — COD collects only at a
  // door weeks away, so a deposit pre-order on COD would reserve units having
  // collected nothing. Checkout hides COD for these carts; this is the
  // backstop. (Pay-later pre-orders have their own dedicated unpaid path —
  // that one is deliberate, this one would be an accident.)
  if (params.hasPreorder) {
    throw new ValidationError(
      "Cash on Delivery is not available for pre-order items",
    );
  }
  if (
    typeof settings?.minOrderAmount === "number" &&
    total < settings.minOrderAmount
  ) {
    throw new ValidationError(
      `Minimum order amount for Cash on Delivery is ${settings.minOrderAmount}`,
    );
  }
  if (
    typeof settings?.maxOrderAmount === "number" &&
    settings.maxOrderAmount > 0 &&
    total > settings.maxOrderAmount
  ) {
    throw new ValidationError(
      `Maximum order amount for Cash on Delivery is ${settings.maxOrderAmount}`,
    );
  }
}
