import { connectDB, mongoose } from "@/lib/db";
import {
  CustomerProfile,
  Order,
  QuoteRequest,
  ReturnRequest,
  Review,
  User,
  Wishlist,
  getSettingsLean,
} from "@/models";
import type { CustomerStats } from "@/types";
import {
  DEFAULT_LOYALTY_SPEND_PER_POINT,
  LOYALTY_TIER_SWITCH,
  computePointsFromOrder,
  computeRefundPointDelta,
  normalizeSpendPerPoint,
  orderSpendPerPoint,
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
import { isCustomerAccount } from "@/lib/access/customer-account";
import {
  setMarketingConsent,
  type MarketingConsentResult,
} from "@/lib/customers/marketing-consent";
import {
  carryGuestProfileForward,
  type ProfileLike,
} from "@/lib/customers/profile-merge";
import {
  MARKETING_CHANNEL,
  MARKETING_CONSENT_SOURCE,
  MARKETING_CONSENT_STATE,
  MARKETING_OPT_IN_LEVEL,
  USER_ROLES,
} from "@/config/app.config";
import { COLLECTED_ORDER_MATCH } from "@/lib/orders/order-payment-status";

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

// The rule this file first wrote now lives in `lib/orders/order-payment-status.ts`,
// where the dashboard, the analytics page and the order stats strip read it too.

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
 *
 * Earned at the store's current rate, which is stamped on the order with the
 * points so a later change of rate never re-prices them.
 */
export async function awardOrderLoyaltyPoints(orderId: string): Promise<number> {
  const spendPerPoint = normalizeSpendPerPoint(
    (await getSettingsLean())?.orders?.loyaltySpendPerPoint,
  );
  return withLoyaltyTransaction(async (session) => {
    const order = await Order.findById(orderId).session(session).lean();
    if (!order?.customerId || order.paymentStatus !== "paid") return 0;
    if (order.loyalty?.pointsAwarded !== undefined) return 0;

    const points = computePointsFromOrder(order.total, spendPerPoint);
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
          "loyalty.spendPerPoint": spendPerPoint,
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
      // The rate the points were given at, not today's: a refund takes back
      // what the order earned.
      orderSpendPerPoint(order.loyalty, DEFAULT_LOYALTY_SPEND_PER_POINT),
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
 * Record a shopper's "email me with news and offers" from checkout.
 *
 * The tick-box used to reach nothing but the abandoned-checkout snapshot, so
 * the one shopper whose consent was kept was the one who walked away — and
 * with abandoned tracking switched off, the box wrote nowhere at all. This
 * puts it where the store actually reads consent from: the customer record,
 * signed in (by userId) or guest (by email, the same row the order's own
 * guest upsert uses).
 *
 * Consent only ever goes ON here. Leaving the box unticked is not a request to
 * be unsubscribed — a shopper who signed up months ago and buys again without
 * noticing the box would otherwise be dropped from the list by an order. The
 * way back out is the unsubscribe link and the account's own preferences.
 *
 * The write itself belongs to `setMarketingConsent`, which owns the state
 * machine; this only says what a ticked checkout box means.
 */
export async function recordCheckoutMarketingConsent(params: {
  accepted?: boolean;
  /** The signed-in shopper, or the account a guest email resolved to. */
  userId?: string | null;
  /** The email a guest checked out under, when there is no account. */
  guestEmail?: string | null;
  /** The order the box was ticked on, kept with the consent for audits. */
  sourceOrderId?: string | null;
  /** The delivery country — what decides whether a pre-tick was lawful there. */
  sourceCountry?: string | null;
  ip?: string | null;
  /**
   * The store asks shoppers to confirm by email. They stay `pending` — not a
   * subscriber, not mailed — until they open the link.
   */
  doubleOptIn?: boolean;
}): Promise<MarketingConsentResult | null> {
  if (params.accepted !== true) return null;

  return setMarketingConsent({
    state: params.doubleOptIn
      ? MARKETING_CONSENT_STATE.PENDING
      : MARKETING_CONSENT_STATE.SUBSCRIBED,
    optInLevel: params.doubleOptIn
      ? MARKETING_OPT_IN_LEVEL.CONFIRMED
      : MARKETING_OPT_IN_LEVEL.SINGLE,
    source: MARKETING_CONSENT_SOURCE.CHECKOUT,
    userId: params.userId,
    guestEmail: params.guestEmail,
    sourceOrderId: params.sourceOrderId,
    sourceCountry: params.sourceCountry,
    ip: params.ip,
    // The shopper is becoming a customer with this order, so the row may not
    // exist yet.
    createIfMissing: true,
  });
}

/**
 * The text-message twin of the box above: "Text me with news and offers",
 * shown instead of the email one when the shopper's contact is a number.
 *
 * Its own record, because agreeing to email is not agreeing to be texted, and
 * keyed on the number when that is all the shopper gave — an email-keyed row
 * cannot hold the consent of someone who left no email.
 */
export async function recordCheckoutSmsConsent(params: {
  accepted?: boolean;
  userId?: string | null;
  guestEmail?: string | null;
  /** E.164, resolved by the caller from the delivery country. */
  phone?: string | null;
  sourceOrderId?: string | null;
  sourceCountry?: string | null;
  ip?: string | null;
}) {
  if (params.accepted !== true) return;
  // Nothing to text, nothing to record.
  if (!params.phone) return;

  await setMarketingConsent({
    channel: MARKETING_CHANNEL.SMS,
    state: MARKETING_CONSENT_STATE.SUBSCRIBED,
    optInLevel: MARKETING_OPT_IN_LEVEL.SINGLE,
    source: MARKETING_CONSENT_SOURCE.CHECKOUT,
    userId: params.userId,
    guestEmail: params.guestEmail,
    phone: params.phone,
    sourceOrderId: params.sourceOrderId,
    sourceCountry: params.sourceCountry,
    ip: params.ip,
    createIfMissing: true,
  });
}

/**
 * Fold a shopper's guest history into their account, keyed by email — the
 * Shopify "account activation" moment. Orders placed as a guest under this
 * email are relinked to the User, quote requests sent while signed out are
 * attached to it, and the guest customer row either becomes the account's
 * profile (userId attached, guest identity cleared) or, when a profile already
 * exists, donates its loyalty balance and is retired.
 *
 * Only for an account that has PROVEN the email (`emailVerified`) — callers
 * check. Anyone can sign up under someone else's address; with the claim
 * behind "not required" or a grace period, doing so handed over that
 * shopper's orders, addresses and points. For the same reason nothing is
 * claimed by phone: a number on a profile is typed, never confirmed, so a
 * guest row keyed on one stays a guest row.
 *
 * Runs on session creation, so it must be cheap when there is nothing to
 * claim: one indexed read and two indexed no-op updateManys, in one round
 * trip.
 */
export async function claimGuestCustomerData(userId: string, email: string) {
  await connectDB();

  const guestEmail = normalizeGuestEmail(email);
  if (!guestEmail || !Types.ObjectId.isValid(userId)) return;
  const userObjectId = new Types.ObjectId(userId);

  // Quote requests are claimed here rather than resolved by email at read
  // time: lib/quotes/quote-offer.ts hands out a price only to a userId, and
  // that is what keeps a merchant's negotiated number off any account that
  // merely typed the same address into a contact form.
  const [guestProfile, linkedOrders, linkedQuotes] = await Promise.all([
    CustomerProfile.findOne({ isGuest: true, email: guestEmail }).lean(),
    Order.updateMany(
      { guestEmail, customerId: { $ne: userObjectId } },
      { $set: { customerId: userObjectId } },
    ),
    QuoteRequest.updateMany(
      { email: guestEmail, userId: { $exists: false } },
      { $set: { userId: userObjectId } },
    ),
  ]);

  if (
    !guestProfile &&
    linkedOrders.modifiedCount === 0 &&
    linkedQuotes.modifiedCount === 0
  ) {
    return;
  }

  // The returns the store opened on those orders go with them: a guest had no
  // account to see one in. Found by the orders' ids, which are indexed, and
  // only when orders moved — a session with nothing to claim pays nothing.
  if (linkedOrders.modifiedCount > 0) {
    const claimedOrders = await Order.find({ guestEmail, customerId: userObjectId })
      .select("_id")
      .lean<Array<{ _id: Types.ObjectId }>>();
    await ReturnRequest.updateMany(
      {
        orderId: { $in: claimedOrders.map((order) => order._id) },
        customerId: { $ne: userObjectId },
      },
      { $set: { customerId: userObjectId } },
    );
  }

  if (guestProfile) {
    await absorbGuestProfile(guestProfile, userObjectId);
  }

  await refreshCustomerStats(userId);
}

/**
 * The account a guest checkout under this email is filed under: a shopper's
 * account whose owner has proven the address. Anything else — no account, an
 * unverified one, a seller's or a team member's — keeps the order a guest
 * order, which the claim above hands over once the address is proven.
 * Attaching it to whichever account merely carried the address gave the
 * order, with its delivery address, to whoever registered that address first.
 */
export async function findAccountForGuestCheckout(
  email: string,
): Promise<{ _id: Types.ObjectId } | null> {
  const guestEmail = normalizeGuestEmail(email);
  if (!guestEmail) return null;
  const account = await User.findOne({
    email: guestEmail,
    emailVerified: true,
    role: USER_ROLES.CUSTOMER,
  })
    .select("_id role roles")
    .lean<{ _id: Types.ObjectId; role?: string; roles?: string[] } | null>();
  return account && isCustomerAccount(account) ? { _id: account._id } : null;
}

/**
 * Fold one guest row into the account: its balance, everything
 * `carryGuestProfileForward` decides is worth keeping, and then the row
 * itself. When the account has no profile yet the row simply becomes it.
 */
async function absorbGuestProfile(
  candidate: { _id: Types.ObjectId },
  userObjectId: Types.ObjectId,
) {
  {
    const existing = await CustomerProfile.findOne({
      userId: userObjectId,
    }).lean();
    if (existing) {
      // The signup hook already gave the account a profile — move the guest
      // balance across and retire the guest row, re-deriving the tier from
      // the merged lifetime total.
      //
      // The row is taken first, and only its taker moves the balance: two
      // sign-ins at once (two tabs, a phone and a laptop) both found the row
      // and both added its points before either deleted it.
      const guestProfile = await CustomerProfile.findOneAndDelete({
        _id: candidate._id,
        isGuest: true,
      }).lean<{
        _id: Types.ObjectId;
        loyaltyPoints?: number;
        lifetimePoints?: number;
      } | null>();
      if (!guestProfile) return;
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
      // The unsubscribe token is unique across the collection, so it could
      // only follow once the row holding it was gone — which it now is.
      const { unsubscribeToken, ...carried } = carryGuestProfileForward(
        guestProfile as unknown as ProfileLike,
        existing as unknown as ProfileLike,
      );
      if (Object.keys(carried).length > 0) {
        await CustomerProfile.updateOne(
          { _id: existing._id },
          { $set: carried },
        );
      }
      if (unsubscribeToken) {
        // Guarded on the account still having none, so a token it minted in
        // the meantime is never overwritten by the retiring row's.
        await CustomerProfile.updateOne(
          { _id: existing._id, unsubscribeToken: { $exists: false } },
          { $set: { unsubscribeToken } },
        );
      }
    } else {
      // No profile yet — the guest row simply becomes the account's profile,
      // keeping its points, tags, and history. The User is the identity
      // source from here on, so the guest fields come off.
      await CustomerProfile.updateOne(
        { _id: candidate._id, isGuest: true },
        {
          $set: { userId: userObjectId },
          // `phone` comes off with the rest of the guest identity: the number
          // lives on the User from here, and leaving it would keep the row in
          // the guest phone index.
          $unset: { isGuest: "", email: "", phone: "", name: "" },
        },
      );
    }
  }
}
