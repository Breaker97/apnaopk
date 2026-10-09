/**
 * BoostPosition Model
 * One rung of the GLOBAL sponsored-placement ladder. Position N renders at
 * visual slot N on every placement deep enough to show it; an unsold rung is
 * filled by a regular product and NEVER compacts upward — compaction would let
 * every vendor buy the cheapest rung and still land on top, collapsing the
 * price ladder. The ladder is global: not per-category, not per-placement.
 *
 * A vendor buys one rung for a date range at `pricePerDay`. The purchase
 * instance is a BoostCampaign; the inventory it consumes is one BoostSlotDay
 * row per booked day.
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import {
  BOOST_MAX_POSITIONS,
  BOOST_POSITION_STATUS,
  type BoostPositionStatus,
} from "@/config/app.config";

interface IBoostPosition extends Document {
  /** Ladder index, 1-based. IMMUTABLE after create. */
  position: number;
  label: string;
  description?: string;
  /** Major units, quantized to `currency` on every write. */
  pricePerDay: number;
  /**
   * Currency the rung was priced in. Checkout refuses when this drifts from
   * settings.general.defaultCurrency rather than silently reinterpreting
   * 1000 JPY as 1000 USD.
   */
  currency: string;
  status: BoostPositionStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const BoostPositionSchema = new Schema<IBoostPosition>(
  {
    position: {
      type: Number,
      required: [true, "Position number is required"],
      min: [1, "Position must be at least 1"],
      max: [BOOST_MAX_POSITIONS, `Position cannot exceed ${BOOST_MAX_POSITIONS}`],
    },
    label: {
      type: String,
      required: [true, "Label is required"],
      trim: true,
      maxlength: [80, "Label cannot exceed 80 characters"],
    },
    description: {
      type: String,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    pricePerDay: {
      type: Number,
      required: [true, "Price per day is required"],
      // A free rung would render in the ladder and then be unbuyable: checkout
      // refuses any total below the currency's minimum. The route re-checks
      // against currencyMinimumPrice(currency) after quantizing.
      min: [0.0001, "Price per day must be greater than zero"],
    },
    currency: { type: String, required: true, uppercase: true, trim: true },
    status: {
      type: String,
      enum: Object.values(BOOST_POSITION_STATUS),
      default: BOOST_POSITION_STATUS.ACTIVE,
    },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

// Query: checkout's findOne({ position, status: "active" }) and the inventory
// key BoostSlotDay.position. Two rows claiming rung 2 would make
// {position, day} ambiguous. Unique across ALL statuses — archiving takes a
// rung off sale but keeps its number reserved for days already sold on it.
BoostPositionSchema.index({ position: 1 }, { unique: true });

// Query: the admin ladder screen and the vendor catalog endpoint both read
// find({ status: "active" }).sort({ position: 1 }).
BoostPositionSchema.index({ status: 1, position: 1 });

export const BoostPosition: Model<IBoostPosition> =
  mongoose.models.BoostPosition ||
  mongoose.model<IBoostPosition>("BoostPosition", BoostPositionSchema);
