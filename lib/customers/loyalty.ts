import type { LoyaltyTier } from "@/types";

/**
 * The loyalty rules, with no database in sight.
 *
 * Deliberately free of `server-only` and of any import beyond the shared types,
 * exactly as `lib/order-payment-status.ts` is: the same thresholds decide what
 * the write path stores (`lib/customer.ts`), what the backfill reconstructs,
 * and what the admin customer form previews in the browser. A client component
 * cannot import `lib/customer.ts` — it pulls in Mongoose — so the rules live
 * here and that module re-exports them.
 */

/**
 * Loyalty tier thresholds based on lifetime points
 */
export const LOYALTY_THRESHOLDS = {
  bronze: 0,
  silver: 500,
  gold: 2000,
  platinum: 5000,
} as const;

/**
 * Compute the loyalty tier based on lifetime points earned
 */
export function computeLoyaltyTier(lifetimePoints: number): LoyaltyTier {
  if (lifetimePoints >= LOYALTY_THRESHOLDS.platinum) return "platinum";
  if (lifetimePoints >= LOYALTY_THRESHOLDS.gold) return "gold";
  if (lifetimePoints >= LOYALTY_THRESHOLDS.silver) return "silver";
  return "bronze";
}

/**
 * {@link computeLoyaltyTier} expressed for MongoDB, so a balance change and the
 * tier it implies land in a single write.
 *
 * The write path uses THIS, never the function above — so the function being
 * green in a unit test proves nothing about what customers are actually
 * assigned. `tests/customer-loyalty.test.ts` evaluates this expression against
 * the function at every threshold boundary to keep the pair honest.
 */
export const LOYALTY_TIER_SWITCH = {
  $switch: {
    branches: [
      {
        case: { $gte: ["$lifetimePoints", LOYALTY_THRESHOLDS.platinum] },
        then: "platinum",
      },
      {
        case: { $gte: ["$lifetimePoints", LOYALTY_THRESHOLDS.gold] },
        then: "gold",
      },
      {
        case: { $gte: ["$lifetimePoints", LOYALTY_THRESHOLDS.silver] },
        then: "silver",
      },
    ],
    default: "bronze",
  },
} as const;

/**
 * Compute loyalty points earned from an order total (1 point per whole unit)
 */
export function computePointsFromOrder(orderTotal: number): number {
  return Math.max(0, Math.floor(orderTotal));
}

/**
 * Return the additional points that must be reversed after cumulative refunds.
 * The whole-point calculation ensures several fractional refunds never exceed
 * the immutable point credit earned by the order.
 */
export function computeRefundPointDelta(
  pointsAwarded: number,
  pointsReversed: number,
  refundedTotal: number,
): number {
  const refundedPoints = Math.floor(Math.max(0, refundedTotal));
  // SIGNED, deliberately. What this answers is "how far is `pointsReversed`
  // from what the refunded total implies", and that gap can point either way:
  // a refund the gateway later rejected takes the order's refunded total back
  // down, and the points it took off the shopper have to follow it.
  //
  // Clamping at zero meant they never did. The refund failed, the shopper was
  // never paid, and they were still short the points — silently, because
  // nothing reports a balance that only ever moves one way.
  return (
    Math.min(Math.max(0, pointsAwarded), refundedPoints) -
    Math.max(0, pointsReversed)
  );
}
