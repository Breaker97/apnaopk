/**
 * BoostSlotDay Model
 * One row per booked (position, day) — the marketplace's physical sponsored
 * inventory. Booking is an insertMany; an E11000 IS the "already taken"
 * answer. Release is deleteMany scoped by campaignId.
 *
 * It is also the delivery record. `day` uses the same UTC "YYYY-MM-DD" axis as
 * BoostMetricDaily.date, so "Position 2 on 2026-09-03 earned N impressions" is
 * a single join. Past rows are NEVER pruned and there is no TTL.
 *
 * Volume: 50 rungs x 365 days = ~18k rows/year.
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";
import { BOOST_DAY_PATTERN } from "@/lib/boosts/boost-days";

interface IBoostSlotDay extends Document {
  /** BoostPosition.position — the visual slot, not the admin row id. */
  position: number;
  /** UTC calendar day, "YYYY-MM-DD". */
  day: string;
  campaignId: Types.ObjectId;
  vendorId: Types.ObjectId;
  productId: Types.ObjectId;
  /** Back-ref to the priced rung; reporting only — `position` is the key. */
  positionId: Types.ObjectId;
  /**
   * The checkout attempt that inserted this row. Compensating deletes are
   * scoped by it, so a retry (or a concurrent request on the SAME campaign)
   * can never delete rows another call inserted. Cleared on fulfilment.
   */
  reservationToken: Types.ObjectId | null;
  /** Delivery sampling for this day. */
  samples: { total: number; failed: number; lastTick: number | null };
  createdAt: Date;
  updatedAt: Date;
}

const BoostSlotDaySchema = new Schema<IBoostSlotDay>(
  {
    position: { type: Number, required: true, min: 1 },
    day: { type: String, required: true, match: BOOST_DAY_PATTERN },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "BoostCampaign",
      required: true,
    },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    positionId: {
      type: Schema.Types.ObjectId,
      ref: "BoostPosition",
      required: true,
    },
    reservationToken: { type: Schema.Types.ObjectId, default: null },
    /**
     * Written by the delivery-sampling cron pass. It MUST be declared: Mongoose
     * is strict by default and silently drops updates to undeclared paths, so
     * an implicit `samples.*` would make the whole proportional-credit
     * mechanism a permanent no-op that no test notices. `lastTick` is the
     * 5-minute bucket, so two overlapping cron runs in one bucket count once.
     */
    samples: {
      type: new Schema(
        {
          total: { type: Number, default: 0 },
          failed: { type: Number, default: 0 },
          lastTick: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: () => ({ total: 0, failed: 0, lastTick: null }),
    },
  },
  { timestamps: true },
);

// (1) THE constraint. Query: every insertMany in lib/boost-slots.ts, plus the
//     pre-check find({ position, day: { $in } }). A concurrent double-purchase
//     loses on E11000 instead of double-booking.
BoostSlotDaySchema.index({ position: 1, day: 1 }, { unique: true });

// (2) A product may hold Position 1 this week and Position 2 next month, but
//     never two rungs on the SAME day — that renders one product twice in one
//     rail and lets one vendor blanket the ladder. Query: the pre-check
//     find({ productId, day: { $in } }).
BoostSlotDaySchema.index({ productId: 1, day: 1 }, { unique: true });

// (3) Query: the availability calendar's find({ day: { $gte, $lte } }) and the
//     admin occupancy strip. {position, day} cannot serve these — `day` is not
//     its prefix.
BoostSlotDaySchema.index({ day: 1, position: 1 });

// (4) Query: find({ campaignId }) in reserveBoostSlotRange's diff, and every
//     deleteMany({ campaignId, ... }) on release.
BoostSlotDaySchema.index({ campaignId: 1 });

// No {vendorId, day}: the availability endpoint loads the whole day range for
// the ladder anyway and partitions "yours" vs "taken" in memory, and a vendor's
// own campaign detail reads by campaignId.

export const BoostSlotDay: Model<IBoostSlotDay> =
  mongoose.models.BoostSlotDay ||
  mongoose.model<IBoostSlotDay>("BoostSlotDay", BoostSlotDaySchema);
