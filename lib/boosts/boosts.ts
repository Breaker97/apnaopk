/**
 * Product boosting — feature gate + campaign lifecycle.
 *
 * Every campaign state transition lives here so the campaign status, its booked
 * BoostSlotDay rows and cache revalidation can never drift apart. All
 * transitions are CAS-guarded (filter on the expected current status) so
 * webhook/verify/cron races resolve to exactly one winner; losers return
 * quietly.
 *
 * Two rules run through the whole file:
 *
 *  - The storefront reads the CAMPAIGN, not a stamp. A booking's window is
 *    fixed at booking time and never rewritten by the cron, so a booking opens
 *    and closes at UTC midnight with no cron tick involved. Only bookkeeping
 *    (status, notifications, credits) depends on the cron.
 *  - Today is consumed, tomorrow is released. Every release passes TOMORROW as
 *    its floor: a day that has already served is billed, its BoostSlotDay row
 *    is the delivery record, and re-selling it would put two products in one
 *    visual slot on one calendar day.
 */

import { Types } from "mongoose";
import {
  BoostCampaign,
  BoostMetricDaily,
  BoostSlotDay,
  PlatformPayment,
  Product,
} from "@/models";
import {
  NON_TERMINAL_BOOST_CAMPAIGN_STATUSES,
  type IBoostCampaign,
} from "@/models/boostCampaign.model";
import type { IPlatformPayment } from "@/models/platformPayment.model";
import { getSettings } from "@/models/settings.model";
import { connectDB } from "@/lib/db";
import { amountsMatchForCurrency, quantizeToCurrency, roundMoney } from "@/lib/intl/money";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { revalidateSponsoredProducts } from "@/lib/cache-invalidation";
import {
  addDays,
  dayEndExclusiveUtc,
  daysBetweenInclusive,
  utcDay,
} from "@/lib/boosts/boost-days";
import {
  releaseAllBoostSlotDays,
  releaseBoostSlotDaysFrom,
  reserveBoostSlotRange,
  sweepOrphanSlotDays,
} from "@/lib/boosts/boost-slots";
import {
  sendBoostNotification,
  type BoostNotificationContext,
  type BoostNotificationEvent,
} from "@/lib/boosts/boost-notifications";
import {
  BOOST_CAMPAIGN_STATUS,
  BOOST_CANCEL_REASON,
  BOOST_FULFILMENT_SETTLE_MS,
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_STATUS,
  PRODUCT_STATUS,
  type BoostCancelReason,
} from "@/config/app.config";

/** Fire-and-forget vendor notification with the product name attached. */
async function notifyCampaign(
  event: BoostNotificationEvent,
  campaign: IBoostCampaign,
  context?: BoostNotificationContext,
) {
  try {
    const product = await Product.findById(campaign.productId)
      .select("name")
      .lean<{ name?: string } | null>();
    await sendBoostNotification(event, campaign, product?.name || "", context);
  } catch (error) {
    console.error(`Failed to dispatch boost ${event} notification:`, error);
  }
}

/** Boosting is a multi-vendor-only feature behind its own master switch. */
export async function assertBoostingEnabled() {
  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled || !settings.boosting?.enabled) {
    throw new NotFoundError("Product boosting");
  }
  return settings;
}

/**
 * A product may only be boosted if a sponsored placement could actually render
 * it. The storefront pool is strictly narrower than "active": it also requires
 * the online-store publishing channel. Selling a placement for a POS-only
 * product takes the money and shows nothing for the whole booking.
 */
export function assertProductIsBoostable(product: {
  status?: string;
  publishing?: { onlineStore?: boolean } | null;
}) {
  if (product.status !== PRODUCT_STATUS.ACTIVE) {
    throw new ValidationError("Only active products can be boosted");
  }
  if (product.publishing?.onlineStore === false) {
    throw new ValidationError(
      "This product is not published to the online store, so a boost would not be shown. Publish it to the online store first.",
    );
  }
}

// ============================================================
// The money ledger
// ============================================================

/**
 * Recompute the outstanding obligation from the one canonical formula. Called
 * by every path that moves releasedDays, unservedDays or refundedAmount, so the
 * number on the admin row is never a stale derivation.
 *
 * `share` sums as fractional days, so a day the product was unrenderable for
 * 60% of samples credits 0.6 x pricePerDay. Subtracting what has already been
 * refunded is what stops the obligation double-counting cash that has left.
 */
export async function refreshBoostCredit(
  campaignId: Types.ObjectId,
): Promise<number> {
  const campaign = await BoostCampaign.findById(campaignId)
    .select("positionSnapshot currency amount releasedDays unservedDays paymentId")
    .lean<{
      positionSnapshot?: { pricePerDay?: number };
      currency: string;
      amount?: number;
      releasedDays?: number;
      unservedDays?: Array<{ share: number }>;
      paymentId?: Types.ObjectId | null;
    } | null>();
  if (!campaign) return 0;

  const paid = campaign.paymentId
    ? await PlatformPayment.findById(campaign.paymentId)
        .select("refundedAmount")
        .lean<{ refundedAmount?: number } | null>()
    : null;

  const unserved = (campaign.unservedDays ?? []).reduce(
    (sum, d) => sum + (d.share ?? 0),
    0,
  );
  const creditDays = (campaign.releasedDays ?? 0) + unserved;
  // Capped at what was actually charged, never the list price. An admin can comp
  // a booking with `amountOverride` — often to zero — while the frozen
  // `pricePerDay` stays the list rate, so the uncapped formula invents an
  // obligation nobody ever paid: the vendor is shown a refund due on a free
  // placement, and "Mark refunded" can never clear it because the settlement is
  // itself capped at a payment of 0.
  const gross = Math.min(
    quantizeToCurrency(
      (campaign.positionSnapshot?.pricePerDay ?? 0) * creditDays,
      campaign.currency,
    ),
    campaign.amount ?? 0,
  );
  const refundable = Math.max(
    0,
    quantizeToCurrency(gross - (paid?.refundedAmount ?? 0), campaign.currency),
  );

  await BoostCampaign.updateOne(
    { _id: campaignId },
    { $set: { refundableAmount: refundable } },
  );
  return refundable;
}

// ============================================================
// Fulfilment
// ============================================================

/**
 * Grant a paid booking. Renamed from `activateBoostCampaign` because it may
 * schedule rather than activate, and it stays the single grantPlatformBenefit
 * target.
 *
 * Idempotent across all three dispatch sites (the CAS winner, a CAS loser
 * re-entering when benefitGrantedAt is null, and the repair path): the status
 * CAS admits exactly one caller and the losers return null having written
 * nothing.
 */
export async function fulfillBoostCampaign(
  payment: IPlatformPayment,
): Promise<IBoostCampaign | null> {
  if (!payment.campaignId) return null;
  const now = new Date();
  const today = utcDay(now);

  const campaign = await BoostCampaign.findOne({
    _id: payment.campaignId,
    status: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
  });
  if (!campaign) return null;

  // Terms guard: a retried checkout rewrote the row and expired its attempt,
  // but the old gateway reference stays payable. Amount alone is NOT enough —
  // Position 1 x 7d and Position 5 x 35d can price identically — so the frozen
  // boostTerms are compared too.
  const termsMatch =
    payment.currency.toUpperCase() === campaign.currency.toUpperCase() &&
    amountsMatchForCurrency(payment.amount, campaign.amount, campaign.currency) &&
    (!payment.boostTerms ||
      (payment.boostTerms.position === campaign.positionSnapshot.position &&
        payment.boostTerms.startDay === campaign.startDay &&
        payment.boostTerms.endDay === campaign.endDay));
  if (!termsMatch) {
    console.error(
      `Boost payment ${payment._id} does not match campaign ${campaign._id} terms; refusing fulfilment`,
    );
    await strandRefusedFulfilment(campaign, payment);
    return null;
  }

  // The whole range lapsed while the gateway held the vendor (booked "today" at
  // 23:50 UTC, callback lands at 00:04). Activating would charge in full for
  // zero delivery and announce a boost whose window already closed.
  if (campaign.endDay < today) {
    console.error(
      `Boost payment ${payment._id} arrived after its window ${campaign.startDay}..${campaign.endDay} closed; refusing fulfilment`,
    );
    await strandRefusedFulfilment(campaign, payment);
    return null;
  }

  const startsNow = campaign.startDay <= today;

  // 1. CAS FIRST. Winning the status makes the rest of this function the sole
  //    owner of the campaign.
  const updated = await BoostCampaign.findOneAndUpdate(
    { _id: campaign._id, status: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT },
    {
      $set: {
        status: startsNow
          ? BOOST_CAMPAIGN_STATUS.ACTIVE
          : BOOST_CAMPAIGN_STATUS.SCHEDULED,
        provider: payment.provider,
        paidAt: payment.paidAt ?? now,
        paymentId: payment._id,
        paidAttemptId: payment._id,
        holdExpiresAt: null, // paid: the hold is now a booking
        ...(startsNow ? { activatedAt: now } : {}),
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) return null; // lost to a cancel or a concurrent grant; nothing inserted, nothing leaks

  // 2. Re-assert the reservation: between redirect and callback the hold may
  //    have lapsed and been swept. A fresh token scopes this call's own
  //    compensating delete; rows the campaign already holds are HELD, not
  //    taken, so a concurrent second grant books nothing.
  //
  //    NOTE: no hold sweep here. Running it from the fulfilment path would let
  //    it cancel the very campaign being paid for.
  const reservationToken = new Types.ObjectId();
  try {
    await reserveBoostSlotRange({
      campaignId: updated._id as Types.ObjectId,
      vendorId: updated.vendorId,
      productId: updated.productId,
      positionId: updated.positionId,
      position: updated.positionSnapshot.position,
      startDay: updated.startDay,
      endDay: updated.endDay,
      reservationToken,
    });
  } catch (error) {
    console.error(
      `Boost payment ${payment._id} is paid but position ${updated.positionSnapshot.position} was resold for ${updated.startDay}..${updated.endDay}:`,
      error,
    );
    await cancelBoostCampaign(
      String(updated._id),
      BOOST_CANCEL_REASON.SLOT_RESOLD,
    );
    await BoostCampaign.updateOne(
      { _id: updated._id },
      { $set: { refundableAmount: payment.amount } },
    );
    return null;
  }

  // Settled inventory, not a reservation any later compensating delete may sweep.
  await BoostSlotDay.updateMany(
    { campaignId: updated._id },
    { $set: { reservationToken: null } },
  );

  // 3. There is no render-model write and nothing to undo. The CAS in (1) IS
  //    the publication step: the storefront reads THIS row, and startsAt/endsAt
  //    were fixed at booking — including on the future-start branch, which is
  //    exactly why a scheduled -> active crossing needs no cron and no cache
  //    bust. A cancel racing this call moves the same row out of the renderable
  //    statuses and the ladder follows on the next read.
  revalidateSponsoredProducts();
  await notifyCampaign(startsNow ? "activated" : "booked", updated);
  return updated;
}

/**
 * Money in, nothing deliverable. Close the campaign, free the inventory and
 * record the full amount as owed — the vendor paid and received not one day, so
 * the obligation is the whole charge, not a proration.
 *
 * Without this the row is stranded forever: `onlyIfUnpaid` refuses it because a
 * PAID attempt exists, the hold sweep skips it for the same reason, and the
 * orphan sweep only looks at terminal campaigns. The rung would stay blocked
 * with no screen showing why.
 */
async function strandRefusedFulfilment(
  campaign: IBoostCampaign,
  payment: IPlatformPayment,
): Promise<void> {
  await cancelBoostCampaign(
    String(campaign._id),
    BOOST_CANCEL_REASON.FULFILMENT_REFUSED,
  );
  await BoostCampaign.updateOne(
    { _id: campaign._id },
    {
      $set: {
        paidAttemptId: payment._id,
        refundableAmount: payment.amount,
      },
    },
  );
}

/** Cron pass 1: a scheduled booking whose first day has arrived. */
async function activateScheduledBoostCampaign(
  campaignId: string,
): Promise<IBoostCampaign | null> {
  const now = new Date();
  const updated = await BoostCampaign.findOneAndUpdate(
    { _id: campaignId, status: BOOST_CAMPAIGN_STATUS.SCHEDULED },
    {
      $set: { status: BOOST_CAMPAIGN_STATUS.ACTIVE, activatedAt: now },
    },
    { returnDocument: "after" },
  );
  if (!updated) return null;
  await notifyCampaign("activated", updated);
  return updated;
}

// ============================================================
// Pause / resume / cancel / expire
// ============================================================

/**
 * Admin pause. Releases every REMAINING day, because holding a paused rung
 * empty is the worst of both worlds: strict indexing hands the visual slot to a
 * regular product anyway, so the marketplace gives the inventory away free and
 * the vendor gets nothing for it. Today is kept — it has already served.
 */
export async function pauseBoostCampaign(
  campaignId: string,
): Promise<IBoostCampaign | null> {
  const now = new Date();
  const updated = await BoostCampaign.findOneAndUpdate(
    { _id: campaignId, status: BOOST_CAMPAIGN_STATUS.ACTIVE },
    { $set: { status: BOOST_CAMPAIGN_STATUS.PAUSED, pausedAt: now } },
    { returnDocument: "after" },
  );
  if (!updated) return null;

  const released = await releaseBoostSlotDaysFrom(
    updated._id as Types.ObjectId,
    addDays(utcDay(now), 1),
  );
  if (released.length > 0) {
    await BoostCampaign.updateOne(
      { _id: updated._id },
      { $inc: { releasedDays: released.length } },
    );
    await refreshBoostCredit(updated._id as Types.ObjectId);
    await notifyCampaign("days_released", updated, { days: released });
  }
  revalidateSponsoredProducts();
  return updated;
}

type ResumeBoostResult =
  | { ok: true; campaign: IBoostCampaign }
  | { ok: false; conflictDays: string[] }
  | null;

/**
 * Admin resume — FALLIBLE, and it says why. Pause released the remaining days
 * to the market, so someone else may have bought them.
 *
 * Re-books through `reserveBoostSlotRange` (never `bookBoostSlotDays`): only the
 * range form deletes the campaign's own blocking rows first and supplies the
 * token every compensating delete is scoped by.
 */
export async function resumeBoostCampaign(
  campaignId: string,
): Promise<ResumeBoostResult> {
  const now = new Date();
  const today = utcDay(now);

  const paused = await BoostCampaign.findOne({
    _id: campaignId,
    status: BOOST_CAMPAIGN_STATUS.PAUSED,
  });
  if (!paused) return null;

  // Nothing left to serve — resuming would render zero days.
  if (paused.endDay < today) {
    await expireBoostCampaign(String(paused._id));
    return null;
  }

  const from = paused.startDay > today ? paused.startDay : today;
  const reservationToken = new Types.ObjectId();
  let booked: string[];
  try {
    const result = await reserveBoostSlotRange({
      campaignId: paused._id as Types.ObjectId,
      vendorId: paused.vendorId,
      productId: paused.productId,
      positionId: paused.positionId,
      position: paused.positionSnapshot.position,
      startDay: from,
      endDay: paused.endDay,
      reservationToken,
    });
    booked = result.booked;
  } catch (error) {
    const conflictDays =
      (error as { conflictDays?: string[] })?.conflictDays ?? [];
    return { ok: false, conflictDays };
  }

  const startsNow = from <= today;
  const updated = await BoostCampaign.findOneAndUpdate(
    { _id: paused._id, status: BOOST_CAMPAIGN_STATUS.PAUSED },
    {
      $set: {
        status: startsNow
          ? BOOST_CAMPAIGN_STATUS.ACTIVE
          : BOOST_CAMPAIGN_STATUS.SCHEDULED,
        pausedAt: null,
      },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    // Lost the CAS — give back exactly what this call re-took.
    await BoostSlotDay.deleteMany({
      campaignId: paused._id,
      reservationToken,
    }).catch(() => undefined);
    return null;
  }

  // Resume reverses the credit it re-takes. Pause credited every remaining day;
  // leaving releasedDays where pause left it would have the campaign rendering
  // days the admin screen still shows as owed. refundedDays is untouched —
  // refunded days are cash that has already moved and are never resumable.
  if (booked.length > 0) {
    await BoostCampaign.updateOne(
      { _id: updated._id },
      { $inc: { releasedDays: -Math.min(booked.length, updated.releasedDays) } },
    );
    await refreshBoostCredit(updated._id as Types.ObjectId);
  }
  revalidateSponsoredProducts();
  await notifyCampaign("activated", updated);
  return { ok: true, campaign: updated };
}

/**
 * Terminal cancel from any non-terminal state.
 *
 * `opts.onlyIfUnpaid` narrows teardown to a campaign no payment has ever
 * settled. It means "no PAID attempt exists", NOT "status is pending": every
 * time fulfilment refuses, money is collected while `paidAt` stays null, and
 * judging by status would cancel a paid campaign whose verify poll then
 * re-enters the grant and fails forever.
 */
export async function cancelBoostCampaign(
  campaignId: string,
  reason: BoostCancelReason = BOOST_CANCEL_REASON.ADMIN,
  opts?: { onlyIfUnpaid?: boolean },
): Promise<IBoostCampaign | null> {
  const now = new Date();

  if (opts?.onlyIfUnpaid) {
    const paidAttempt = await PlatformPayment.exists({
      kind: PLATFORM_PAYMENT_KIND.BOOST,
      campaignId,
      status: PLATFORM_PAYMENT_STATUS.PAID,
    });
    if (paidAttempt) return null;
  }

  // Count what a paid cancel will hand back BEFORE the status write, so the
  // credit can ride along with it. A paid booking keeps today — it served, it
  // is billed, and its row is the delivery record; an unpaid hold consumed
  // nothing, so all of it goes back and none of it is credited.
  const firstReleasable = addDays(utcDay(now), 1);
  const willRelease = await BoostSlotDay.countDocuments({
    campaignId,
    day: { $gte: firstReleasable },
  });

  const updated = await BoostCampaign.findOneAndUpdate(
    {
      _id: campaignId,
      status: opts?.onlyIfUnpaid
        ? BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT
        : { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
    },
    {
      $set: {
        status: BOOST_CAMPAIGN_STATUS.CANCELED,
        canceledAt: now,
        cancelReason: reason,
        holdExpiresAt: null,
      },
      // Credited in the SAME write that terminates the campaign. Releasing the
      // rows first and incrementing after leaves a window where a crash gives
      // the inventory away without paying the vendor back for it.
      ...(willRelease > 0 ? { $inc: { releasedDays: willRelease } } : {}),
    },
    { returnDocument: "after" },
  );
  if (!updated) return null;

  // Safe to do after the status write: a CANCELED campaign is not renderable,
  // so rows lingering for a moment cannot double-render, and sweepOrphanSlotDays
  // reclaims them if this next step never happens.
  const released = updated.paidAt
    ? await releaseBoostSlotDaysFrom(
        updated._id as Types.ObjectId,
        firstReleasable,
      )
    : ((await releaseAllBoostSlotDays(updated._id as Types.ObjectId)), []);

  await PlatformPayment.updateMany(
    { campaignId: updated._id, status: PLATFORM_PAYMENT_STATUS.PENDING },
    { $set: { status: PLATFORM_PAYMENT_STATUS.EXPIRED } },
  );

  // The unpaid path credits nothing, so back the increment out if the count
  // above raced a hold that had not been paid for.
  if (!updated.paidAt && willRelease > 0) {
    await BoostCampaign.updateOne(
      { _id: updated._id },
      { $inc: { releasedDays: -willRelease } },
    );
  } else if (released.length > 0 || willRelease > 0) {
    await refreshBoostCredit(updated._id as Types.ObjectId);
  }
  revalidateSponsoredProducts();
  // A cancelled unpaid checkout is not an "ended boost" — the vendor never had
  // one. Nor is a refused fulfilment: the admin tells them, not a notice about
  // a boost that never ran.
  if (updated.paidAt && reason !== BOOST_CANCEL_REASON.FULFILMENT_REFUSED) {
    await notifyCampaign("ended", updated);
  }
  return updated;
}

/** Terminal expiry once the booked range has passed. */
async function expireBoostCampaign(
  campaignId: string,
): Promise<IBoostCampaign | null> {
  const updated = await BoostCampaign.findOneAndUpdate(
    {
      _id: campaignId,
      status: {
        $in: [
          BOOST_CAMPAIGN_STATUS.SCHEDULED,
          BOOST_CAMPAIGN_STATUS.ACTIVE,
          BOOST_CAMPAIGN_STATUS.PAUSED,
        ],
      },
    },
    { $set: { status: BOOST_CAMPAIGN_STATUS.EXPIRED } },
    { returnDocument: "after" },
  );
  if (!updated) return null;

  revalidateSponsoredProducts();
  await notifyCampaign("ended", updated);
  return updated;
}

/**
 * Truncate a booking to `newEndDay`, releasing everything past it.
 *
 * **Window first, rows second, and the credit rides with the window.** There
 * are no transactions here, so the order of these two writes is the whole
 * safety argument:
 *
 *  - Deleting the rows first would put the days back on sale while the campaign
 *    still claims them — the storefront reads `endsAt`, so the ad would keep
 *    rendering on days a competitor had already bought. Two products, one
 *    visual slot.
 *  - Shrinking the window first can only leave rows held slightly too long.
 *    That is invisible to shoppers, and `sweepOrphanSlotDays` reclaims any row
 *    stranded past its campaign's own `endDay` on the next cron tick.
 *
 * `releasedDays` moves in the SAME update as `endDay`, so a crash can never
 * release inventory without crediting it — the failure this ordering exists to
 * make impossible.
 *
 * `creditReleasedDays` is opt-in because the partial-refund path computes the
 * credit from the cumulative refund instead, in its own CAS; incrementing here
 * as well would count those days twice.
 *
 * `billedDays` is deliberately never rewritten — it is the immutable basis
 * every later refund derives from.
 */
export async function truncateBoostCampaign(
  campaignId: Types.ObjectId,
  newEndDay: string,
  opts?: { creditReleasedDays?: boolean },
): Promise<string[]> {
  const today = utcDay();
  const firstReleasable = addDays(today, 1);
  const filter = {
    campaignId,
    day: { $gt: newEndDay, $gte: firstReleasable },
  };
  const released = (
    await BoostSlotDay.find(filter).select("day").lean<Array<{ day: string }>>()
  )
    .map((r) => r.day)
    .sort();

  await BoostCampaign.updateOne({ _id: campaignId }, {
    $set: { endDay: newEndDay, endsAt: dayEndExclusiveUtc(newEndDay) },
    ...(opts?.creditReleasedDays && released.length > 0
      ? { $inc: { releasedDays: released.length } }
      : {}),
  });

  if (released.length > 0) await BoostSlotDay.deleteMany(filter);

  revalidateSponsoredProducts();
  return released;
}

// ============================================================
// Releasing inventory when a booked product goes dark
// ============================================================

type BoostReleaseSummary = {
  campaignId: string;
  /** Future days handed back to the calendar. */
  releasedDays: string[];
  /** True when nothing was left to run and the booking was cancelled outright. */
  canceled: boolean;
};

/**
 * What releasing a product's future bookings WOULD do, without doing it.
 *
 * The write paths below take effect immediately and irreversibly — a released
 * day is back on sale and a competitor can take it the same second — so the UI
 * has to be able to name the days and the credit before the vendor commits,
 * not after. Same query as the release itself, so the preview cannot drift from
 * the action.
 */
export async function previewBoostReleaseForProduct(
  productId: Types.ObjectId | string,
): Promise<{ days: string[]; credit: number | null; currency: string }> {
  const fromDay = addDays(utcDay(), 1);
  const campaigns = await BoostCampaign.find({
    productId,
    status: { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
  })
    .select("_id currency positionSnapshot.pricePerDay")
    .lean<
      Array<{
        _id: Types.ObjectId;
        currency: string;
        positionSnapshot?: { pricePerDay?: number };
      }>
    >();
  if (campaigns.length === 0) return { days: [], credit: 0, currency: "" };

  const days: string[] = [];
  const currencies = new Set<string>();
  let credit = 0;
  for (const campaign of campaigns) {
    const rows = await BoostSlotDay.find({
      campaignId: campaign._id,
      day: { $gte: fromDay },
    })
      .select("day")
      .lean<Array<{ day: string }>>();
    if (rows.length === 0) continue;
    days.push(...rows.map((r) => r.day));
    currencies.add(campaign.currency);
    credit += (campaign.positionSnapshot?.pricePerDay ?? 0) * rows.length;
  }

  // A product can hold bookings in more than one currency once the store's
  // default has changed, and adding those together produces a number that means
  // nothing in either. Report the days — which are true regardless — and let
  // the caller omit a total it cannot state honestly.
  const [currency, ...rest] = [...currencies];
  const mixed = rest.length > 0;

  return {
    days: [...new Set(days)].sort(),
    credit: mixed || !currency ? null : quantizeToCurrency(credit, currency),
    currency: mixed ? "" : (currency ?? ""),
  };
}

/**
 * Hand every FUTURE booked day for these campaigns back to the calendar.
 *
 * A forfeited future day is worse than a vendor-level loss: it burns a global
 * rung nobody else can buy, for the rest of the booking. So a product or vendor
 * going dark releases the inventory now rather than leaving a dead booking to
 * expire quietly weeks later.
 *
 * Today is never released — it has already served, its row is the delivery
 * record, and re-selling it would put two products in one visual slot on one
 * calendar day. Today's shortfall is handled by the sampling sweep instead,
 * which credits the fraction of the day that actually failed.
 *
 * A booking with nothing left to run is CANCELLED rather than truncated:
 * truncating would derive an end day at or before the start, and `updateOne`
 * runs without validators so the schema minimum would never fire.
 */
async function releaseBoostCampaigns(
  campaigns: Array<{
    _id: Types.ObjectId;
    startDay: string;
    billedDays: number;
    paidAt?: Date | null;
  }>,
  reason: BoostCancelReason,
  context?: BoostNotificationContext,
): Promise<BoostReleaseSummary[]> {
  const today = utcDay();
  const out: BoostReleaseSummary[] = [];

  for (const campaign of campaigns) {
    try {
      // Paid FIRST, dates second. An unpaid hold has served nothing whatever
      // its dates say — treating its start day as consumed would keep today's
      // row off the market and record a day the vendor never paid for.
      const served = campaign.paidAt ? consumedDays(campaign) : 0;
      if (served <= 0) {
        // Nothing has run: the whole booking goes, days and all.
        const canceled = await cancelBoostCampaign(String(campaign._id), reason);
        if (canceled) {
          out.push({
            campaignId: String(campaign._id),
            releasedDays: [],
            canceled: true,
          });
        }
        continue;
      }

      // The credit is incremented inside the same write that shrinks the
      // window, so inventory can never be released without being credited.
      const released = await truncateBoostCampaign(campaign._id, today, {
        creditReleasedDays: true,
      });
      if (released.length === 0) continue;

      await refreshBoostCredit(campaign._id);

      const fresh = await BoostCampaign.findById(campaign._id);
      if (fresh) {
        await notifyCampaign("days_released", fresh, {
          ...context,
          days: released,
        });
      }
      out.push({
        campaignId: String(campaign._id),
        releasedDays: released,
        canceled: false,
      });
    } catch (error) {
      console.error(
        "Failed to release boost inventory for campaign",
        campaign._id,
        error,
      );
    }
  }

  if (out.length > 0) revalidateSponsoredProducts();
  return out;
}

type BoostableShape = {
  status?: string;
  publishing?: { onlineStore?: boolean } | null;
};

/** The purchase guard, as a boolean. Same rule, so the two can never disagree. */
function isProductBoostable(product: BoostableShape): boolean {
  try {
    assertProductIsBoostable(product);
    return true;
  } catch {
    return false;
  }
}

/**
 * Release a product's future bookings only if THIS edit is what made it
 * unrenderable.
 *
 * Comparing before against after is what keeps this idempotent: saving an
 * already-unpublished product must not re-release (there is nothing left) and
 * must not re-notify. Re-publishing does not restore anything — the days went
 * back on sale the moment they were released, and someone may already hold
 * them.
 */
export async function releaseBoostInventoryIfProductWentDark(
  productId: Types.ObjectId | string,
  before: BoostableShape,
  after: BoostableShape,
): Promise<BoostReleaseSummary[]> {
  if (!isProductBoostable(before) || isProductBoostable(after)) return [];
  return releaseBoostInventoryForProduct(
    productId,
    BOOST_CANCEL_REASON.PRODUCT_UNAVAILABLE,
  );
}

/** One product went dark — unpublished, archived, or out of the online store.
 * @public — reached by tests through a dynamic import, which knip cannot follow.
 */
export async function releaseBoostInventoryForProduct(
  productId: Types.ObjectId | string,
  reason: BoostCancelReason = BOOST_CANCEL_REASON.ADMIN,
): Promise<BoostReleaseSummary[]> {
  const campaigns = await BoostCampaign.find({
    productId,
    status: { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
  })
    .select("_id startDay billedDays paidAt")
    .lean<
      Array<{
        _id: Types.ObjectId;
        startDay: string;
        billedDays: number;
        paidAt?: Date | null;
      }>
    >();
  if (campaigns.length === 0) return [];
  return releaseBoostCampaigns(campaigns, reason);
}

/**
 * A whole store went dark — suspended, deactivated, or a lapsed subscription.
 *
 * The sponsored pool requires `vendor.storeActive`, so every one of this
 * vendor's rungs is already rendering a filler; without this they would stay
 * booked and unbuyable until the last booking ran out.
 */
export async function releaseBoostInventoryForVendor(
  vendorId: Types.ObjectId | string,
  reason: BoostCancelReason = BOOST_CANCEL_REASON.ADMIN,
): Promise<BoostReleaseSummary[]> {
  const campaigns = await BoostCampaign.find({
    vendorId,
    status: { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
  })
    .select("_id startDay billedDays paidAt")
    .lean<
      Array<{
        _id: Types.ObjectId;
        startDay: string;
        billedDays: number;
        paidAt?: Date | null;
      }>
    >();
  if (campaigns.length === 0) return [];
  return releaseBoostCampaigns(campaigns, reason);
}

/** Days of a booking that have already been consumed, through today. */
export function consumedDays(campaign: {
  startDay: string;
  billedDays: number;
}): number {
  const today = utcDay();
  if (today < campaign.startDay) return 0;
  return Math.min(
    campaign.billedDays,
    daysBetweenInclusive(campaign.startDay, today),
  );
}

/**
 * Observed impressions per day, per rung, over the last `windowDays`.
 *
 * The evidence base for the ladder's price, and the honest half of what a
 * vendor is told before buying: the admin screen prices a rung against it and
 * the purchase dialog quotes it beside the reach line. Without it the first
 * vendor to ask how Position 1 compares with Position 3 opens a ticket nobody
 * can answer, and the admin re-prices the ladder on instinct.
 *
 * Keyed by `positionSnapshot.position` — the rung as it was SOLD. Reading
 * through to BoostPosition instead would re-attribute history whenever a rung
 * is deleted and its number reused.
 */
export async function getPositionDeliveryAverages(
  windowDays = 30,
  now = new Date(),
): Promise<Record<number, number>> {
  const today = utcDay(now);
  const since = addDays(today, -windowDays);

  const rows = await BoostMetricDaily.aggregate<{
    _id: number | null;
    impressions: number;
    days: number;
  }>([
    { $match: { date: { $gte: since, $lte: today } } },
    // Fold placements together first: one campaign-day is one day of delivery
    // however many surfaces it rendered on.
    {
      $group: {
        _id: { campaignId: "$campaignId", date: "$date" },
        impressions: { $sum: "$impressions" },
      },
    },
    {
      $lookup: {
        from: "boostcampaigns",
        localField: "_id.campaignId",
        foreignField: "_id",
        as: "campaign",
        pipeline: [{ $project: { position: "$positionSnapshot.position" } }],
      },
    },
    { $unwind: "$campaign" },
    {
      $group: {
        _id: "$campaign.position",
        impressions: { $sum: "$impressions" },
        days: { $sum: 1 },
      },
    },
  ]);

  const averages: Record<number, number> = {};
  for (const row of rows) {
    // {position, day} is unique, so no two campaigns share a rung-day and the
    // day count is a true denominator rather than a sum of overlaps.
    if (typeof row._id !== "number" || row.days <= 0) continue;
    averages[row._id] = Math.round(row.impressions / row.days);
  }
  return averages;
}

// ============================================================
// The cron reconciler
// ============================================================

interface BoostReconcileSummary {
  activated: number;
  expired: number;
  holdsReleased: number;
  orphanDays: number;
  sampled: number;
  canceledDangling: number;
  reminded: number;
  startReminded: number;
  errors: number;
}

const DANGLING_PAGE_SIZE = 200;
const DANGLING_MAX_PAGES = 25;
const EXPIRY_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Free holds whose window lapsed.
 *
 * A campaign with a live PENDING attempt is left alone. One whose attempt has
 * been PAID for longer than the settle window is NOT skipped — that is the
 * paid-but-unfulfilled row, and skipping it is what strands inventory forever.
 * Inside the settle window it is left alone so an in-flight grant is never
 * pre-empted.
 */
export async function releaseLapsedBoostHolds(
  now = new Date(),
  limit = 200,
): Promise<number> {
  const candidates = await BoostCampaign.find({
    status: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
    holdExpiresAt: { $lte: now },
  })
    .limit(limit)
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  if (candidates.length === 0) return 0;

  const ids = candidates.map((c) => c._id);
  const attempts = await PlatformPayment.find({
    kind: PLATFORM_PAYMENT_KIND.BOOST,
    campaignId: { $in: ids },
    status: {
      $in: [PLATFORM_PAYMENT_STATUS.PENDING, PLATFORM_PAYMENT_STATUS.PAID],
    },
  })
    .select("campaignId status paidAt")
    .lean<
      Array<{ campaignId?: Types.ObjectId; status: string; paidAt?: Date | null }>
    >();

  const inFlight = new Set<string>();
  const settledPaid = new Set<string>();
  const settleFloor = new Date(now.getTime() - BOOST_FULFILMENT_SETTLE_MS);
  for (const a of attempts) {
    if (!a.campaignId) continue;
    const key = String(a.campaignId);
    if (a.status === PLATFORM_PAYMENT_STATUS.PENDING) inFlight.add(key);
    else if (a.paidAt && a.paidAt <= settleFloor) settledPaid.add(key);
    else inFlight.add(key); // paid, but still inside the settle window
  }

  let released = 0;
  for (const id of ids) {
    const key = String(id);
    if (inFlight.has(key)) continue;
    try {
      if (settledPaid.has(key)) {
        // Money collected, nothing granted. Close it deliberately rather than
        // leaving a rung blocked behind a PAID attempt nobody can see.
        const campaign = await BoostCampaign.findById(id).lean<{
          amount: number;
        } | null>();
        if (
          await cancelBoostCampaign(key, BOOST_CANCEL_REASON.FULFILMENT_REFUSED)
        ) {
          await BoostCampaign.updateOne(
            { _id: id },
            { $set: { refundableAmount: campaign?.amount ?? 0 } },
          );
          released += 1;
        }
      } else if (
        await cancelBoostCampaign(key, BOOST_CANCEL_REASON.HOLD_EXPIRED, {
          onlyIfUnpaid: true,
        })
      ) {
        released += 1;
      }
    } catch (error) {
      console.error("Failed to release lapsed boost hold", id, error);
    }
  }
  return released;
}

/**
 * Eight passes, every five minutes.
 *
 * None of this is required for RENDERING: the storefront reads each campaign's
 * booked window, which is fixed at booking, so a booking goes live and ends at
 * UTC midnight with no cron involvement at all. What degrades without the cron
 * is bookkeeping — status advancement, notifications and delivery credits — and
 * holds, which the availability endpoint also frees lazily.
 */
export async function reconcileBoostCampaigns(
  limit = 100,
  now = new Date(),
): Promise<BoostReconcileSummary> {
  await connectDB();
  const summary: BoostReconcileSummary = {
    activated: 0,
    expired: 0,
    holdsReleased: 0,
    orphanDays: 0,
    sampled: 0,
    canceledDangling: 0,
    reminded: 0,
    startReminded: 0,
    errors: 0,
  };
  const today = utcDay(now);

  // 1 · Activate — a scheduled booking whose first day has arrived.
  const due = await BoostCampaign.find({
    status: BOOST_CAMPAIGN_STATUS.SCHEDULED,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  })
    .limit(limit)
    .select("_id productId vendorId")
    .lean<Array<{ _id: Types.ObjectId; productId: Types.ObjectId }>>();
  for (const row of due) {
    try {
      // A five-minute stock blip at 00:03 must not forfeit a 30-day booking, so
      // a failed eligibility check leaves it scheduled to retry next tick.
      // Only permanent conditions (product gone) go to the dangling pass.
      const product = await Product.findById(row.productId)
        .select("status publishing.onlineStore")
        .lean<{ status?: string; publishing?: { onlineStore?: boolean } } | null>();
      if (!product) continue;
      try {
        assertProductIsBoostable(product);
      } catch {
        continue;
      }
      if (await activateScheduledBoostCampaign(String(row._id))) {
        summary.activated += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error("Failed to activate scheduled boost", row._id, error);
    }
  }

  // 2 · Expire — including a range that lapsed entirely while the cron was
  //     down, which goes straight to expired rather than briefly active.
  const lapsed = await BoostCampaign.find({
    status: {
      $in: [
        BOOST_CAMPAIGN_STATUS.SCHEDULED,
        BOOST_CAMPAIGN_STATUS.ACTIVE,
        BOOST_CAMPAIGN_STATUS.PAUSED,
      ],
    },
    endsAt: { $lte: now },
  })
    .sort({ endsAt: 1 })
    .limit(limit)
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  for (const row of lapsed) {
    try {
      if (await expireBoostCampaign(String(row._id))) summary.expired += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("Failed to expire boost campaign", row._id, error);
    }
  }

  // 3 · Holds.
  try {
    summary.holdsReleased = await releaseLapsedBoostHolds(now, limit * 2);
  } catch (error) {
    summary.errors += 1;
    console.error("Failed to release lapsed boost holds", error);
  }

  // 4 · Orphan slot-days.
  try {
    summary.orphanDays = await sweepOrphanSlotDays(now);
  } catch (error) {
    summary.errors += 1;
    console.error("Failed to sweep orphaned boost slot-days", error);
  }

  // 5 · Delivery sampling — did today's booked products actually render?
  try {
    summary.sampled = await sampleBoostDelivery(now);
  } catch (error) {
    summary.errors += 1;
    console.error("Failed to sample boost delivery", error);
  }

  // 6 · Dangling products. Deletion cancels inline (lib/products/product-cleanup),
  //     so this only catches products removed some other way.
  let cursor: Types.ObjectId | null = null;
  for (let page = 0; page < DANGLING_MAX_PAGES; page += 1) {
    const live: Array<{ _id: Types.ObjectId; productId: Types.ObjectId }> =
      await BoostCampaign.find({
        status: { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
        ...(cursor ? { _id: { $gt: cursor } } : {}),
      })
        .sort({ _id: 1 })
        .limit(DANGLING_PAGE_SIZE)
        .select("_id productId")
        .lean<Array<{ _id: Types.ObjectId; productId: Types.ObjectId }>>();
    if (live.length === 0) break;
    cursor = live[live.length - 1]._id;

    const existing = new Set(
      (
        await Product.find({ _id: { $in: live.map((r) => r.productId) } })
          .select("_id")
          .lean<Array<{ _id: Types.ObjectId }>>()
      ).map((r) => String(r._id)),
    );
    for (const row of live) {
      if (existing.has(String(row.productId))) continue;
      try {
        if (
          await cancelBoostCampaign(
            String(row._id),
            BOOST_CANCEL_REASON.PRODUCT_DELETED,
          )
        ) {
          summary.canceledDangling += 1;
        }
      } catch (error) {
        summary.errors += 1;
        console.error("Failed to cancel dangling boost", row._id, error);
      }
    }
    if (live.length < DANGLING_PAGE_SIZE) break;
  }

  // 7 · Expiring-soon reminder. `billedDays >= 3` stops a 24-hour warning firing
  //     at or before a 1–2 day booking even starts.
  const expiringSoon = await BoostCampaign.find({
    status: BOOST_CAMPAIGN_STATUS.ACTIVE,
    endsAt: { $gt: now, $lte: new Date(now.getTime() + EXPIRY_REMINDER_WINDOW_MS) },
    expiryReminderSentAt: null,
    billedDays: { $gte: 3 },
  })
    .limit(limit)
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  for (const row of expiringSoon) {
    try {
      const claimed = await BoostCampaign.findOneAndUpdate(
        { _id: row._id, expiryReminderSentAt: null },
        { $set: { expiryReminderSentAt: now } },
        { returnDocument: "after" },
      );
      if (!claimed) continue;
      await notifyCampaign("expiring_soon", claimed);
      summary.reminded += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("Failed to send boost expiry reminder", row._id, error);
    }
  }

  // 8 · Starts-tomorrow reminder. With a 60-day horizon a vendor otherwise gets
  //     a "booked" notice in August and silence until October.
  const startingSoon = await BoostCampaign.find({
    status: BOOST_CAMPAIGN_STATUS.SCHEDULED,
    startDay: addDays(today, 1),
    startReminderSentAt: null,
  })
    .limit(limit)
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  for (const row of startingSoon) {
    try {
      const claimed = await BoostCampaign.findOneAndUpdate(
        { _id: row._id, startReminderSentAt: null },
        { $set: { startReminderSentAt: now } },
        { returnDocument: "after" },
      );
      if (!claimed) continue;
      await notifyCampaign("starts_tomorrow", claimed);
      summary.startReminded += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("Failed to send boost start reminder", row._id, error);
    }
  }

  return summary;
}

/**
 * Was each of today's booked products actually renderable?
 *
 * Counters live on the slot-day row (bounded, one per booked day) and are folded
 * onto the campaign as fractional `unservedDays`. The fold writes to the
 * CAMPAIGN, not the slot-day, so the credit evidence is not deleted by the
 * thing that pays it.
 */
async function sampleBoostDelivery(now: Date): Promise<number> {
  const today = utcDay(now);
  const rows = await BoostSlotDay.find({ day: today })
    .select("_id campaignId productId samples")
    .lean<
      Array<{
        _id: Types.ObjectId;
        campaignId: Types.ObjectId;
        productId: Types.ObjectId;
        samples?: { total?: number; failed?: number; lastTick?: number | null };
      }>
    >();
  if (rows.length === 0) return 0;

  const { getStorefrontBoostingSettings, getSponsoredEligibilityFilter } =
    await import("@/lib/boosts/sponsored-products");
  const boosting = await getStorefrontBoostingSettings();
  const eligible = new Set(
    (
      await Product.find({
        _id: { $in: rows.map((r) => r.productId) },
        ...(await getSponsoredEligibilityFilter({
          hideOutOfStock: boosting.hideOutOfStock,
        })),
      })
        .select("_id")
        .lean<Array<{ _id: Types.ObjectId }>>()
    ).map((p) => String(p._id)),
  );

  // One 5-minute bucket, so two overlapping cron runs count once.
  const tick = Math.floor(now.getTime() / (5 * 60 * 1000));
  const touched = new Set<string>();

  for (const row of rows) {
    if (row.samples?.lastTick === tick) continue;
    const ok = eligible.has(String(row.productId));
    await BoostSlotDay.updateOne(
      { _id: row._id, "samples.lastTick": { $ne: tick } },
      {
        $inc: { "samples.total": 1, ...(ok ? {} : { "samples.failed": 1 }) },
        $set: { "samples.lastTick": tick },
      },
    );
    touched.add(String(row.campaignId));

    const total = (row.samples?.total ?? 0) + 1;
    const failed = (row.samples?.failed ?? 0) + (ok ? 0 : 1);
    const share = total > 0 ? failed / total : 0;
    const rounded = roundMoney(share);

    if (rounded >= 0.1) {
      // Revise in place; push only when the day is absent. Push-once-and-never-
      // revise freezes the credit at whatever the FIRST qualifying tick saw: a
      // five-minute outage at 00:05 scores 1 of 1 and would credit a whole day.
      const hit = await BoostCampaign.updateOne(
        { _id: row.campaignId, "unservedDays.day": today },
        { $set: { "unservedDays.$.share": rounded } },
      );
      if (hit.matchedCount === 0) {
        const pushed = await BoostCampaign.updateOne(
          { _id: row.campaignId, "unservedDays.day": { $ne: today } },
          { $push: { unservedDays: { day: today, share: rounded } } },
        );
        // Only on the tick that FIRST crosses the floor. Every later tick of
        // the same day revises the share in place above and sends nothing —
        // the notification's dedupe key is day-scoped as a second line of
        // defence, but a booking sampled every 5 minutes would otherwise lean
        // on it 288 times a day.
        if (pushed.modifiedCount > 0) {
          const campaign = await BoostCampaign.findById(row.campaignId);
          if (campaign) {
            await notifyCampaign("not_delivered", campaign, { day: today });
          }
        }
      }
    } else {
      // Recovered before the floor: the day must stop being credited, or a
      // product briefly out of stock at dawn is paid for as if it never ran.
      await BoostCampaign.updateOne(
        { _id: row.campaignId },
        { $pull: { unservedDays: { day: today } } },
      );
    }
  }

  // Once per affected campaign after the fold, not once per row.
  for (const id of touched) {
    await refreshBoostCredit(new Types.ObjectId(id)).catch(() => undefined);
  }
  return rows.length;
}
