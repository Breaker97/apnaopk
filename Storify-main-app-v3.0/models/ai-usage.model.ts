/**
 * AI Usage Model
 * Per-user, per-day counters for AI authoring generations. Backs the daily
 * usage caps in Settings → AI and gives admins an auditable usage trail.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

interface IAIUsage extends Document {
  userId: string;
  /** UTC calendar day, "YYYY-MM-DD". */
  day: string;
  textCount: number;
  imageCount: number;
  updatedAt: Date;
}

const AIUsageSchema = new Schema<IAIUsage>(
  {
    userId: { type: String, required: true },
    day: { type: String, required: true },
    textCount: { type: Number, default: 0 },
    imageCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

AIUsageSchema.index({ userId: 1, day: 1 }, { unique: true });

export const AIUsage: Model<IAIUsage> =
  (mongoose.models.AIUsage as Model<IAIUsage>) ||
  mongoose.model<IAIUsage>("AIUsage", AIUsageSchema);
