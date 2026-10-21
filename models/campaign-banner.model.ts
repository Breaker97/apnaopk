import { mongoose } from "@/lib/db";
import {
  CAMPAIGN_BANNER_STATUSES,
  CAMPAIGN_BANNER_TYPES,
} from "@/lib/campaign-banners/types";

const { Schema, models, model } = mongoose;

/**
 * A Campaign Banner: a popup or bar the storefront Home page shows for a
 * while. One collection for the platform's banners (`vendorId` null, the
 * Coupon precedent) and each vendor's own.
 *
 * The fields a list filters and sorts on are real columns; the rest of what an
 * editor sets (content, countdown, signup, rules) is Mixed, with its contract
 * in lib/campaign-banners/types.ts — normalized on every write and every read,
 * like a slider's slides.
 */
const CampaignBannerSchema = new Schema(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
    name: {
      type: String,
      required: [true, "Banner name is required"],
      trim: true,
      maxlength: [100, "Banner name cannot exceed 100 characters"],
    },
    type: { type: String, enum: CAMPAIGN_BANNER_TYPES, default: "popup" },
    status: { type: String, enum: CAMPAIGN_BANNER_STATUSES, default: "draft" },
    priority: { type: Number, default: 50, min: 0, max: 100 },
    /** ISO instants (UTC); either may be absent. */
    schedule: {
      start: { type: String },
      end: { type: String },
    },
    content: { type: Schema.Types.Mixed, default: {} },
    couponCode: { type: String, default: "" },
    countdown: { type: Schema.Types.Mixed, default: {} },
    signup: { type: Schema.Types.Mixed, default: {} },
    rules: { type: Schema.Types.Mixed, default: {} },
    /** The user who created it. */
    createdBy: { type: String },
  },
  { timestamps: true },
);

// The dashboard list: one owner's banners, newest edit first or by status.
CampaignBannerSchema.index({ vendorId: 1, updatedAt: -1 });
// The storefront read: one owner's active banners.
CampaignBannerSchema.index({ vendorId: 1, status: 1, priority: -1 });

if (models.CampaignBanner) {
  delete models.CampaignBanner;
}

export const CampaignBanner = model("CampaignBanner", CampaignBannerSchema);
