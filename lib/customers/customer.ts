import { connectDB, mongoose } from "@/lib/db";
import { CustomerProfile, Order, Review, User, Wishlist } from "@/models";
import type { CustomerStats } from "@/types";
import {
  LOYALTY_TIER_SWITCH,
  computePointsFromOrder,
  computeRefundPointDelta,
} from "@/lib/customers/loyalty";
import { type ClientSession, Types } from "mongoose";

// The rules themselves live in `lib/loyalty.ts`, which the admin customer form
// also imports — a client component cannot pull in this module's Mongoose
// dependencies. Re-exported so existing server-side importers are unaffected.
export {
  LOYALTY_THRESHOLDS,
  LOYALTY_TIER_SWITCH,
  computeLoyaltyTier,
  computePointsFromOrder,
  computeRefundPointDelta,
} from "@/lib/customers/loyalty";
import { roundMoney } from "@/lib/intl/money";

function isTransactionUnsupported(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Transaction numbers are only allowed on a replica set member or mongos/i.test(
      error.message,
    )
  );
}

async function withLoyaltyTransaction<T>(
  work: (session: ClientSession | null) => Promise<T>,
): Promise<T> {
  await connectDB();
  const session = await mongoose.startSession();

  try {
    let result!: T;
    try {
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } catch (error) {
      // Local MongoDB instances commonly run without a replica set. The
      // guarded Order.updateOne claim below remains idempotent in that mode;
      // use it rather than dropping points for an otherwise successful payment.
      //
      // What this mode gives up is atomicity, and only in one direction: the
      // claim is written BEFORE the profile, so a failure between the two
      // leaves an order marked as awarded whose points never reached the
      // customer. That is the safe half of the trade — the reverse ordering
      // would double-credit on retry, which no later run could detect. The
      // stranded credit is recoverable: `scripts/backfill-loyalty-points.ts`
      // rebuilds profiles from the orders and restores it. On a replica set
      // (any production deployment) neither case arises.
      if (!isTransactionUnsupported(error)) throw error;
      return work(null);
    }
  } finally {
    await session.endSession();
  }
}

function normalizeGuestEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Count money actually collected: unpaid pending orders inflated totalSpent
 * (10 abandoned COD checkouts looked like real revenue), while paid gateway
 * orders were the ones that mattered. COD orders count once delivered even if
 * payment is still marked pending. Shared by the registered and guest stats
 * refreshers so both kinds of customer are measured by the same rule.
 */
const COLLECTED_ORDER_MATCH: Record<string, unknown> = {
  status: { $ne: "cancelled" },
  $or: [
    {
      paymentStatus: {
        $in: ["paid", "partially_paid", "partially_refunded", "refunded"],
      },
    },
    { status: "delivered" },
  ],
};

const ORDER_STATS_GROUP = {
  $group: {
    _id: null as null,
    totalOrders: { $sum: 1 },
    totalSpent: { $sum: "$total" },
    averageOrderValue: { $avg: "$total" },
    lastOrderDate: { $max: "$createdAt" },
  },
};

const EMPTY_ORDER_STATS = {
  totalOrders: 0,
  totalSpent: 0,
  averageOrderValue: 0,
  lastOrderDate: null,
};

/**
 * Apply a balance change and derive its tier in one MongoDB write. This keeps
 * concurrent successful payments from leaving a stale loyalty tier behind.
 */
async function applyLoyaltyProfileDelta(
  userId: string,
  delta: number,
  session: ClientSession | null,
) {
  const userObjectId = new Types.ObjectId(userId);

  // Create any missing profile through a PLAIN upsert first. Mongoose applies
  // neither schema defaults nor timestamps to an aggregation-pipeline update,
  // so letting the pipeline below do the inserting produced a profile with no
  // `createdAt` — which the account page shows as "member since" and the admin
  // customer list sorts by — and none of the stats/notification defaults.
  // A no-op for the profile every registered customer already has.
  await CustomerProfile.updateOne(
    { userId: userObjectId },
    { $setOnInsert: { loyaltyPoints: 0, lifetimePoints: 0, loyaltyTier: "bronze" } },
    { upsert: true, session: session ?? undefined },
  );

  await CustomerProfile.updateOne(
    { userId: userObjectId },
    [
      {
        $set: {
          loyaltyPoints: {
            $max: [
              0,
              { $add: [{ $ifNull: ["$loyaltyPoints", 0] }, delta] },
            ],
          },
          lifetimePoints: {
            $max: [
              0,
              { $add: [{ $ifNull: ["$lifetimePoints", 0] }, delta] },
            ],
          },
          lastActiveAt: "$$NOW",
        },
      },
      { $set: { loyaltyTier: LOYALTY_TIER_SWITCH } },
    ],
    { session: session ?? undefined },
  );
}

/** The email-keyed twin of applyLoyaltyProfileDelta for guest customer rows. */
async function applyGuestLoyaltyProfileDelta(
  email: string,
  delta: number,
  session: ClientSession | null,
) {
  await CustomerProfile.updateOne(
    { isGuest: true, email },
    {
      $setOnInsert: {
        loyaltyPoints: 0,
        lifetimePoints: 0,
        loyaltyTier: "bronze",
      },
    },
    { upsert: true, session: session ?? undefined },
  );

  await CustomerProfile.updateOne(
    { isGuest: true, email },
    [
      {
        $set: {
          loyaltyPoints: {
            $max: [
              0,
              { $add: [{ $ifNull: ["$loyaltyPoints", 0] }, delta] },
            ],
          },
          lifetimePoints: {
            $max: [
              0,
              { $add: [{ $ifNull: ["$lifetimePoints", 0] }, delta] },
            ],
          },
          lastActiveAt: "$$NOW",
        },
      },
      { $set: { loyaltyTier: LOYALTY_TIER_SWITCH } },
    ],
    { session: session ?? undefined },
  );
}

/**
 * Route an order's loyalty delta to whichever customer record owns the order:
 * the User-keyed profile for signed-in purchases, the email-keyed guest
 * profile for guest checkouts. Orders whose customerId resolves to no User at
 * all are skipped — historic guest orders point customerId at the guest's
 * cart, and crediting that id is what used to mint unclaimable phantom
 * profiles.
 */
async function applyOrderLoyaltyDelta(
  order: { customerId?: unknown; guestEmail?: string | null },
  delta: number,
  session: ClientSession | null,
) {
  const guestEmail = normalizeGuestEmail(order.guestEmail);
  if (guestEmail) {
    await applyGuestLoyaltyProfileDelta(guestEmail, delta, session);
    return;
  }
  if (!order.customerId) return;
  const customerId = String(order.customerId);
  if (!Types.ObjectId.isValid(customerId)) return;
  const userExists = await User.exists({ _id: customerId }).session(
    session ?? null,
  );
  if (!userExists) return;
  await applyLoyaltyProfileDelta(customerId, delta, session);
}

/**
 * Award an order's whole-number points exactly once after its full payment has
 * been committed. The order's loyalty subdocument is the durable retry claim.
 */
export async function awardOrderLoyaltyPoints(orderId: string): Promise<number> {
  return withLoyaltyTransaction(async (session) => {
    const order = await Order.findById(orderId).session(session).lean();
    if (!order?.customerId || order.paymentStatus !== "paid") return 0;
    if (order.loyalty?.pointsAwarded !== undefined) return 0;

    const points = computePointsFromOrder(order.total);
    const claim = await Order.updateOne(
      {
        _id: order._id,
        paymentStatus: "paid",
        "loyalty.pointsAwarded": { $exists: false },
      },
      {
        $set: {
          "loyalty.pointsAwarded": points,
          "loyalty.pointsReversed": 0,
          "loyalty.awardedAt": new Date(),
        },
      },
      { session: session ?? undefined },
    );
    if (claim.matchedCount !== 1) return 0;

    if (points > 0) {
      await applyOrderLoyaltyDelta(order, points, session);
    }

    return points;
  });
}

/**
 * Reverse only the additional point amount implied by the order's cumulative
 * successful refunds. Re-running after the same refund is a no-op.
 */
export async function reverseOrderLoyaltyPoints(orderId: string): Promise<number> {
  return withLoyaltyTransaction(async (session) => {
    const order = await Order.findById(orderId).session(session).lean();
    if (!order?.customerId || order.loyalty?.pointsAwarded === undefined) {
      return 0;
    }

    const pointsReversed = order.loyalty.pointsReversed ?? 0;
    const delta = computeRefundPointDelta(
      order.loyalty.pointsAwarded,
      pointsReversed,
      order.refundedTotal ?? 0,
    );
    if (delta === 0) return 0;

    const claim = await Order.updateOne(
      {
        _id: order._id,
        "loyalty.pointsAwarded": order.loyalty.pointsAwarded,
        "loyalty.pointsReversed": pointsReversed,
      },
      {
        $set: {
          "loyalty.pointsReversed": pointsReversed + delta,
          "loyalty.lastReversedAt": new Date(),
        },
      },
      { session: session ?? undefined },
    );
    if (claim.matchedCount !== 1) return 0;

    await applyOrderLoyaltyDelta(order, -delta, session);
    return delta;
  });
}

/**
 * Ensure a customer profile exists for the given userId.
 * Creates one with defaults if it doesn't exist, then runs an initial stats refresh.
 */
export async function ensureCustomerProfile(userId: string) {
  await connectDB();

  let profile = await CustomerProfile.findOne({ userId }).lean();
  if (!profile) {
    profile = (
      await CustomerProfile.create({ userId: new Types.ObjectId(userId) })
    ).toObject();
    // Backfill stats for users who may already have orders/reviews/wishlists
    await refreshCustomerStats(userId);
    profile = await CustomerProfile.findOne({ userId }).lean();
  }
  return profile;
}

/**
 * Recompute and update cached stats from source collections (Order, Review, Wishlist).
 * Called after order completion, review creation, wishlist changes, etc.
 * Uses aggregation pipelines for efficiency.
 */
export async function refreshCustomerStats(userId: string) {
  await connectDB();

  const userObjectId = new Types.ObjectId(userId);

  const [orderStats, reviewStats, wishlist] = await Promise.all([
    Order.aggregate([
      { $match: { customerId: userObjectId, ...COLLECTED_ORDER_MATCH } },
      ORDER_STATS_GROUP,
    ]),
    Review.aggregate([
      { $match: { userId: userObjectId } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: "$rating" },
        },
      },
    ]),
    Wishlist.findOne({ userId }),
  ]);

  const orderData = orderStats[0] || EMPTY_ORDER_STATS;
  const reviewData = reviewStats[0] || {
    totalReviews: 0,
    averageRating: null,
  };

  const stats: CustomerStats = {
    totalOrders: orderData.totalOrders,
    totalSpent: roundMoney(orderData.totalSpent),
    averageOrderValue: roundMoney(orderData.averageOrderValue),
    lastOrderDate: orderData.lastOrderDate,
    totalReviews: reviewData.totalReviews,
    averageRating: reviewData.averageRating
      ? Math.round(reviewData.averageRating * 10) / 10
      : undefined,
    totalWishlistItems: wishlist?.items?.length || 0,
  };

  // Upsert only when a real User backs the id. Historic guest orders point
  // customerId at the guest's cart, and the payment finalizers used to feed
  // that id straight in here — which is exactly what minted the phantom
  // customer rows the admin list counted but could never display.
  if (await User.exists({ _id: userObjectId })) {
    await CustomerProfile.findOneAndUpdate(
      { userId },
      { $set: { stats, lastActiveAt: new Date() } },
      { upsert: true },
    );
  }

  return stats;
}

/**
 * The guest twin of refreshCustomerStats: recompute the cached stats of an
 * email-keyed guest customer row from the orders placed under that email.
 * Reviews and wishlists require an account, so those figures stay zero.
 */
async function refreshGuestCustomerStats(email: string) {
  await connectDB();

  const guestEmail = normalizeGuestEmail(email);
  if (!guestEmail) return null;

  const [orderStats] = await Order.aggregate([
    { $match: { guestEmail, ...COLLECTED_ORDER_MATCH } },
    ORDER_STATS_GROUP,
  ]);
  const orderData = orderStats || EMPTY_ORDER_STATS;

  const stats: CustomerStats = {
    totalOrders: orderData.totalOrders,
    totalSpent: roundMoney(orderData.totalSpent),
    averageOrderValue: roundMoney(orderData.averageOrderValue),
    lastOrderDate: orderData.lastOrderDate,
    totalReviews: 0,
    averageRating: undefined,
    totalWishlistItems: 0,
  };

  await CustomerProfile.findOneAndUpdate(
    { isGuest: true, email: guestEmail },
    { $set: { stats, lastActiveAt: new Date() } },
    { upsert: true },
  );

  return stats;
}

/**
 * Refresh the cached stats of whichever customer record owns an order — the
 * User-keyed profile for signed-in purchases, the email-keyed guest row for
 * guest checkouts. The payment finalizers call this instead of choosing a key
 * themselves, so a guest payment can never mint a profile under a cart id.
 */
export async function refreshCustomerStatsForOrder(order: {
  customerId?: unknown;
  guestEmail?: string | null;
}) {
  const guestEmail = normalizeGuestEmail(order.guestEmail);
  if (guestEmail) return refreshGuestCustomerStats(guestEmail);
  if (!order.customerId) return null;
  const customerId = String(order.customerId);
  if (!Types.ObjectId.isValid(customerId)) return null;
  return refreshCustomerStats(customerId);
}

/**
 * Create or refresh the guest customer row for a checkout email — the
 * Shopify model, where every checkout leaves a customer record behind and an
 * account is an optional login on top of it. One row per email, however many
 * carts that shopper goes through. Callers only reach this for emails with no
 * registered account; checkout attaches those orders to the User instead.
 */
export async function upsertGuestCustomerProfile(params: {
  email: string;
  name?: string | null;
}) {
  await connectDB();

  const email = normalizeGuestEmail(params.email);
  if (!email) return;

  const set: Record<string, unknown> = { lastActiveAt: new Date() };
  const name = typeof params.name === "string" ? params.name.trim() : "";
  if (name) set.name = name;

  await CustomerProfile.updateOne(
    { isGuest: true, email },
    {
      $set: set,
      $setOnInsert: {
        loyaltyPoints: 0,
        lifetimePoints: 0,
        loyaltyTier: "bronze",
      },
    },
    { upsert: true },
  );
}

/**
 * Fold a shopper's guest history into their account, keyed by email — the
 * Shopify "account activation" moment. Orders placed as a guest under this
 * email are relinked to the User, and the guest customer row either becomes
 * the account's profile (userId attached, guest identity cleared) or, when a
 * profile already exists, donates its loyalty balance and is retired.
 *
 * Runs on session creation, so it must be cheap when there is nothing to
 * claim: one indexed profile read and one indexed no-op updateMany.
 */
export async function claimGuestCustomerData(userId: string, email: string) {
  await connectDB();

  const guestEmail = normalizeGuestEmail(email);
  if (!guestEmail || !Types.ObjectId.isValid(userId)) return;
  const userObjectId = new Types.ObjectId(userId);

  const [guestProfile, linkedOrders] = await Promise.all([
    CustomerProfile.findOne({ isGuest: true, email: guestEmail }).lean(),
    Order.updateMany(
      { guestEmail, customerId: { $ne: userObjectId } },
      { $set: { customerId: userObjectId } },
    ),
  ]);

  if (!guestProfile && linkedOrders.modifiedCount === 0) return;

  if (guestProfile) {
    const existing = await CustomerProfile.findOne({ userId: userObjectId })
      .select("_id")
      .lean();
    if (existing) {
      // The signup hook already gave the account a profile — move the guest
      // balance across and retire the guest row, re-deriving the tier from
      // the merged lifetime total.
      await CustomerProfile.updateOne({ _id: existing._id }, [
        {
          $set: {
            loyaltyPoints: {
              $add: [
                { $ifNull: ["$loyaltyPoints", 0] },
                guestProfile.loyaltyPoints || 0,
              ],
            },
            lifetimePoints: {
              $add: [
                { $ifNull: ["$lifetimePoints", 0] },
                guestProfile.lifetimePoints || 0,
              ],
            },
            lastActiveAt: "$$NOW",
          },
        },
        { $set: { loyaltyTier: LOYALTY_TIER_SWITCH } },
      ]);
      await CustomerProfile.deleteOne({ _id: guestProfile._id });
    } else {
      // No profile yet — the guest row simply becomes the account's profile,
      // keeping its points, tags, and history. The User is the identity
      // source from here on, so the guest fields come off.
      await CustomerProfile.updateOne(
        { _id: guestProfile._id },
        {
          $set: { userId: userObjectId },
          $unset: { isGuest: "", email: "", name: "" },
        },
      );
    }
  }

  await refreshCustomerStats(userId);
}
