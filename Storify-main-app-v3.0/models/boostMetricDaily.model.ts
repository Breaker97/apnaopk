/**
 * BoostMetricDaily Model
 * Daily impression/click buckets per boost campaign per placement, written by
 * bulk $inc upserts from the tracking beacon endpoint. At most one document
 * per (campaign, UTC day, placement) — bounded growth, cheap aggregation.
 * Campaign lifetime totals are also $inc'd onto BoostCampaign for list views;
 * this collection is the source for day charts and placement breakdowns.
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";
import { BOOST_PLACEMENT, type BoostPlacement } from "@/config/app.config";

interface IBoostMetricDaily extends Document {
  campaignId: Types.ObjectId;
  vendorId: Types.ObjectId;
  productId: Types.ObjectId;
  /** UTC calendar day, "YYYY-MM-DD". */
  date: string;
  placement: BoostPlacement;
  impressions: number;
  clicks: number;
  createdAt: Date;
  updatedAt: Date;
}

const BoostMetricDailySchema = new Schema<IBoostMetricDaily>(
  {
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "BoostCampaign",
      required: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    placement: {
      type: String,
      enum: Object.values(BOOST_PLACEMENT),
      required: true,
    },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

// Upsert target for the beacon endpoint's $inc writes.
BoostMetricDailySchema.index(
  { campaignId: 1, date: 1, placement: 1 },
  { unique: true },
);

export const BoostMetricDaily: Model<IBoostMetricDaily> =
  mongoose.models.BoostMetricDaily ||
  mongoose.model<IBoostMetricDaily>("BoostMetricDaily", BoostMetricDailySchema);
