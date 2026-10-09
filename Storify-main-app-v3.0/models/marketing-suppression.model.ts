import { mongoose } from "@/lib/db";
import type { Model } from "mongoose";
import {
  MARKETING_CONSENT_SOURCE,
  MARKETING_CONSENT_SOURCES,
  type MarketingConsentSource,
} from "@/config/app.config";

const { Schema, models, model } = mongoose;

/**
 * "Stop emailing me", from an address, kept apart from the customer list.
 *
 * Written when someone uses an unsubscribe link, for the address the link was
 * made for. Most of them have no customer record — they abandoned a checkout
 * and were never anyone's customer — and inventing one to hold the refusal
 * would list them as customers for having said no. It is written for those
 * who do have a record too: their record can say only "not subscribed" when
 * they never joined, and in a store that sends checkout reminders to everyone
 * that is not a refusal of anything.
 *
 * Read by `getMarketingSuppressions`, and outranked by one thing only: a
 * subscription given after it (the checkout box, the account page), which is
 * the newer and more deliberate answer. Anything else — an order placed
 * without the box ticked, a record created later — leaves it standing.
 *
 * Deleted, not flagged, when the shopper takes it back from the same page.
 */
interface IMarketingSuppression {
  _id: mongoose.Types.ObjectId;
  /** Lowercased, as every consent lookup compares it. */
  email: string;
  source: MarketingConsentSource;
  suppressedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MarketingSuppressionSchema = new Schema<IMarketingSuppression>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    source: {
      type: String,
      enum: MARKETING_CONSENT_SOURCES,
      default: MARKETING_CONSENT_SOURCE.UNSUBSCRIBE_LINK,
    },
    suppressedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

// One row per address. Nothing depends on it for correctness — a store running
// without it (autoIndex off) may hold two rows for one address after two
// simultaneous clicks, and any row suppresses while a resubscribe deletes them
// all — but it keeps the lookup an index read.
MarketingSuppressionSchema.index({ email: 1 }, { unique: true });

export const MarketingSuppression = ((models.MarketingSuppression as
  | Model<IMarketingSuppression>
  | undefined) ??
  model<IMarketingSuppression>(
    "MarketingSuppression",
    MarketingSuppressionSchema,
  )) as Model<IMarketingSuppression>;
