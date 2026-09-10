import { mongoose } from "@/lib/db";
import type { IReview } from "@/types";

const { Schema, models, model } = mongoose;

/**
 * Review Schema
 */
const ReviewSchema = new Schema<IReview>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot exceed 5"],
    },
    title: {
      type: String,
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    comment: {
      type: String,
      required: [true, "Comment is required"],
      maxlength: [1000, "Comment cannot exceed 1000 characters"],
    },
    images: {
      type: [String],
      default: [],
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    reply: {
      type: new Schema(
        {
          comment: {
            type: String,
            required: true,
            maxlength: [1000, "Reply cannot exceed 1000 characters"],
          },
          userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
          },
        },
        { _id: false, timestamps: true }
      ),
      default: undefined,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
// Serves the public product-reviews query (filter productId + isApproved, sort
// createdAt desc) and its rating-breakdown aggregate (prefix match). It also
// supersedes the former standalone { productId: 1 } index (a productId-only
// query is served by this index's prefix, as well as by the unique compound
// below), which was removed here. Databases predating that change keep the old
// index until it is dropped by hand — Mongoose never drops what it no longer
// declares.
ReviewSchema.index({ productId: 1, isApproved: 1, createdAt: -1 });
ReviewSchema.index({ userId: 1 });
ReviewSchema.index({ rating: 1 });
// Serves the admin review list: filtered ({isApproved} + createdAt sort) via
// the compound, unfiltered default sort + date-window counts via {createdAt}.
// The former single-field { isApproved: 1 } became a redundant prefix (drop it
// from existing DBs via the index migration script).
ReviewSchema.index({ isApproved: 1, createdAt: -1 });
ReviewSchema.index({ createdAt: -1 });

// Ensure one review per product per user per order
ReviewSchema.index({ productId: 1, userId: 1, orderId: 1 }, { unique: true });

// Virtual for user
ReviewSchema.virtual("user", {
  ref: "User",
  localField: "userId",
  foreignField: "_id",
  justOne: true,
});

// Virtual for product
ReviewSchema.virtual("product", {
  ref: "Product",
  localField: "productId",
  foreignField: "_id",
  justOne: true,
});

export const Review = models.Review || model<IReview>("Review", ReviewSchema);
