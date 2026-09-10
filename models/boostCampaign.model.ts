/**
 * BoostCampaign Model
 * One purchased booking: one product on one ladder rung, for one inclusive
 * range of UTC days, for one vendor. Payment attempts live on PlatformPayment
 * (kind "boost"); the campaign only records the winning one.
 *
 * This row is ALSO the storefront's render model. The ladder pool reads
 * campaigns whose window is still open and joins products by `_id` — there is
 * no denormalized stamp on Product, because a second copy of "who holds rung N
 * right now" is a second thing every release path has to keep in step, and
 * missing one renders a refunded day.
 *
 * The physical inventory a campaign consumes is one BoostSlotDay row per booked
 * day; `startDay`/`endDay` here and those rows are kept in step by
 * lib/boost-slots.ts.
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";
import {
  BOOST_CAMPAIGN_STATUS,
  BOOST_CANCEL_REASON,
  PLATFORM_PAYMENT_PROVIDER,
  type BoostCampaignStatus,
  type BoostCancelReason,
  type PlatformPaymentProvider,
} from "@/config/app.config";
import { BOOST_DAY_PATTERN } from "@/lib/boosts/boost-days";

/**
 * Frozen ladder terms. What the vendor bought stays true even if the admin
 * re-prices or archives the rung tomorrow.
 */
export interface IBoostPositionSnapshot {
  position: number;
  label: string;
  pricePerDay: number;
  currency: string;
}

/** A day the storefront could not render the paid product, and how much of it. */
export interface IBoostUnservedDay {
  day: string;
  /** (0,1] — the fraction of the day's samples that failed. */
  share: number;
}

export interface IBoostCampaign extends Document {
  vendorId: Types.ObjectId;
  userId: string;
  productId: Types.ObjectId;
  positionId: Types.ObjectId;
  positionSnapshot: IBoostPositionSnapshot;
  /** Inclusive UTC "YYYY-MM-DD" bounds of the booking. */
  startDay: string;
  endDay: string;
  /**
   * Days originally charged. IMMUTABLE after fulfilment — it is the basis every
   * later proration derives from, so truncating a booking must never rewrite
   * it. The live range is derived: endDay = startDay + (billedDays - refundedDays) - 1.
   */
  billedDays: number;
  status: BoostCampaignStatus;
  /** dayStartUtc(startDay) — written at BOOKING, not at payment. */
  startsAt: Date | null;
  /** dayEndExclusiveUtc(endDay) — the instant the booking stops rendering. */
  endsAt: Date | null;
  /** When an unpaid hold on the booked days lapses. */
  holdExpiresAt: Date | null;
  activatedAt: Date | null;
  provider: PlatformPaymentProvider | null;
  amount: number;
  currency: string;
  paidAt: Date | null;
  paymentId: Types.ObjectId | null;
  /** Set as soon as ANY attempt reaches PAID — what `onlyIfUnpaid` reads. */
  paidAttemptId: Types.ObjectId | null;
  pausedAt: Date | null;
  canceledAt: Date | null;
  cancelReason: BoostCancelReason | null;
  /** Cumulative days handed back by pause / cancel / partial refund. */
  releasedDays: number;
  /** The refund-driven subset of releasedDays; monotonic, and the refund CAS target. */
  refundedDays: number;
  /** Outstanding obligation, recomputed by refreshBoostCredit. */
  refundableAmount: number;
  unservedDays: IBoostUnservedDay[];
  /** Set once the expiring-soon reminder went out (cron CAS dedupe). */
  expiryReminderSentAt: Date | null;
  /** Set once the starts-tomorrow reminder went out (cron CAS dedupe). */
  startReminderSentAt: Date | null;
  totalImpressions: number;
  totalClicks: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Every status a campaign can still change out of. Replaces
 * LIVE_BOOST_CAMPAIGN_STATUSES: `scheduled` belongs here too, and the old name
 * implied "currently rendering", which `pending_payment` and `paused` are not.
 */
export const NON_TERMINAL_BOOST_CAMPAIGN_STATUSES: BoostCampaignStatus[] = [
  BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
  BOOST_CAMPAIGN_STATUS.SCHEDULED,
  BOOST_CAMPAIGN_STATUS.ACTIVE,
  BOOST_CAMPAIGN_STATUS.PAUSED,
];

const BoostCampaignSchema = new Schema<IBoostCampaign>(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    userId: { type: String, required: true },
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    positionId: {
      type: Schema.Types.ObjectId,
      ref: "BoostPosition",
      required: true,
    },
    positionSnapshot: {
      type: new Schema<IBoostPositionSnapshot>(
        {
          position: { type: Number, required: true, min: 1 },
          label: { type: String, required: true },
          pricePerDay: { type: Number, required: true, min: 0 },
          currency: { type: String, required: true, uppercase: true },
        },
        { _id: false },
      ),
      required: true,
    },
    startDay: { type: String, required: true, match: BOOST_DAY_PATTERN },
    endDay: { type: String, required: true, match: BOOST_DAY_PATTERN },
    billedDays: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: Object.values(BOOST_CAMPAIGN_STATUS),
      default: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
    },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    holdExpiresAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    provider: {
      type: String,
      enum: [...Object.values(PLATFORM_PAYMENT_PROVIDER), null],
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: [0, "Amount cannot be negative"],
    },
    currency: { type: String, required: true, uppercase: true, trim: true },
    paidAt: { type: Date, default: null },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "PlatformPayment",
      default: null,
    },
    paidAttemptId: {
      type: Schema.Types.ObjectId,
      ref: "PlatformPayment",
      default: null,
    },
    pausedAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    cancelReason: {
      type: String,
      enum: [...Object.values(BOOST_CANCEL_REASON), null],
      default: null,
    },
    releasedDays: { type: Number, default: 0, min: 0 },
    refundedDays: { type: Number, default: 0, min: 0 },
    refundableAmount: { type: Number, default: 0, min: 0 },
    unservedDays: {
      type: [
        new Schema<IBoostUnservedDay>(
          {
            day: { type: String, required: true, match: BOOST_DAY_PATTERN },
            share: { type: Number, required: true, min: 0, max: 1 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    expiryReminderSentAt: { type: Date, default: null },
    startReminderSentAt: { type: Date, default: null },
    totalImpressions: { type: Number, default: 0 },
    totalClicks: { type: Number, default: 0 },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

// Vendor list, admin list + status filter.
BoostCampaignSchema.index({ vendorId: 1, createdAt: -1 });
BoostCampaignSchema.index({ status: 1, createdAt: -1 });
// Cron expiry scan, AND the storefront ladder pool's
// {status: {$in: [ACTIVE, SCHEDULED]}, endsAt: {$gt: now}} — so rendering adds
// no index of its own.
BoostCampaignSchema.index({ status: 1, endsAt: 1 });
// Cron pass 1: scheduled campaigns whose window has opened.
BoostCampaignSchema.index({ status: 1, startsAt: 1 });
// Cron pass 3: unpaid holds that have lapsed.
BoostCampaignSchema.index({ status: 1, holdExpiresAt: 1 });
// Admin ladder: campaigns on one rung.
BoostCampaignSchema.index({ positionId: 1, status: 1 });

// No one-live-campaign-per-product index. A product may legitimately hold this
// week's Position 1 and next month's Position 2; what it may never do is hold
// two rungs on the SAME day, and that is enforced where the inventory lives —
// BoostSlotDay's unique {productId, day}.

export const BoostCampaign: Model<IBoostCampaign> =
  mongoose.models.BoostCampaign ||
  mongoose.model<IBoostCampaign>("BoostCampaign", BoostCampaignSchema);
