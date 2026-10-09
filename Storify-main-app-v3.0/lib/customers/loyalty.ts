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
 * Whether the loyalty programme is switched on for this build.
 *
 * Loyalty is half built: paid orders earn points and refunds take them back,
 * but nothing lets a customer spend them and a tier gives nothing. Until the
 * rest exists the whole feature stays out of sight and paid orders stop
 * earning, unless `NEXT_PUBLIC_LOYALTY_ENABLED` is exactly "true".
 *
 * Read literally so Next inlines it into client bundles: the admin screens,
 * the storefront account and the payment code all get the same answer, and a
 * change needs a rebuild (a restart in dev). Points already earned keep
 * following refunds while it is off — `reverseOrderLoyaltyPoints` is never
 * gated.
 */
export function isLoyaltyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LOYALTY_ENABLED === "true";
}

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
 * How much a customer spends, in the store currency, for each point — the
 * store's `orders.loyaltySpendPerPoint`.
 *
 * Points used to be one per whole currency unit, which is a dollar in one
 * store and a taka in another. The tiers above are counted in points, so a
 * single 5,000৳ order made a taka store's customer Platinum. The default keeps
 * that rule for the stores it suits; a taka store sets 100 and its customers
 * climb the tiers at the pace a dollar store's do.
 */
export const DEFAULT_LOYALTY_SPEND_PER_POINT = 1;
export const MIN_LOYALTY_SPEND_PER_POINT = 0.01;
export const MAX_LOYALTY_SPEND_PER_POINT = 1_000_000;

/** A usable rate: a positive, finite amount, or the default. */
export function normalizeSpendPerPoint(value: unknown): number {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_LOYALTY_SPEND_PER_POINT;
}

/**
 * The whole points in an amount. Trimmed the way `roundMoney` trims, so 0.3 at
 * 0.1 per point is 3 points rather than the 2 that binary floating point would
 * floor it to.
 */
function wholePoints(amount: number, spendPerPoint: number): number {
  const points = Number((amount / normalizeSpendPerPoint(spendPerPoint)).toPrecision(12));
  return Math.max(0, Math.floor(points));
}

/**
 * The rate an order earns at: the one stamped on it when its points were
 * awarded, one point per unit for an order awarded before stores had a rate,
 * and today's rate for an order not awarded yet.
 *
 * Reversals and the backfill read it, so a rate changed later never re-prices
 * points already given: a refund takes back what the order earned, not what it
 * would earn today.
 */
export function orderSpendPerPoint(
  loyalty:
    | { pointsAwarded?: number | null; spendPerPoint?: number | null }
    | null
    | undefined,
  storeSpendPerPoint: unknown,
): number {
  if (loyalty?.spendPerPoint != null) {
    return normalizeSpendPerPoint(loyalty.spendPerPoint);
  }
  if (loyalty?.pointsAwarded != null) return DEFAULT_LOYALTY_SPEND_PER_POINT;
  return normalizeSpendPerPoint(storeSpendPerPoint);
}

/**
 * Compute loyalty points earned from an order total: one for every
 * `spendPerPoint` spent, whole points only.
 */
export function computePointsFromOrder(
  orderTotal: number,
  spendPerPoint: number = DEFAULT_LOYALTY_SPEND_PER_POINT,
): number {
  return wholePoints(orderTotal, spendPerPoint);
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
  /** The rate the order earned at — see `orderSpendPerPoint`. */
  spendPerPoint: number = DEFAULT_LOYALTY_SPEND_PER_POINT,
): number {
  const refundedPoints = wholePoints(Math.max(0, refundedTotal), spendPerPoint);
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
