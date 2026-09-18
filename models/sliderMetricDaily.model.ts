/**
 * SliderMetricDaily Model
 * Daily impression/click buckets per saved-slider slide, written by bulk
 * $inc upserts from the /api/track/slider beacon. At most one document per
 * (slider handle, slide id, UTC day) — bounded growth, cheap aggregation.
 * Keyed by handle rather than ObjectId because that is how sections bind a
 * slider and how the storefront knows it; a slide's id is the slide's own.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

export interface ISliderMetricDaily extends Document {
  handle: string;
  slideId: string;
  /** UTC calendar day, "YYYY-MM-DD". */
  date: string;
  impressions: number;
  clicks: number;
  createdAt: Date;
  updatedAt: Date;
}

const SliderMetricDailySchema = new Schema<ISliderMetricDaily>(
  {
    handle: { type: String, required: true, maxlength: 120 },
    slideId: { type: String, required: true, maxlength: 64 },
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
  },
  { timestamps: true },
);

SliderMetricDailySchema.index({ handle: 1, slideId: 1, date: 1 }, { unique: true });
SliderMetricDailySchema.index({ handle: 1, date: 1 });

export const SliderMetricDaily: Model<ISliderMetricDaily> =
  mongoose.models.SliderMetricDaily ||
  mongoose.model<ISliderMetricDaily>("SliderMetricDaily", SliderMetricDailySchema);
