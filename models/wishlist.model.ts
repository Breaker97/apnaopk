/**
 * Wishlist Model
 * Stores user's saved products
 */

import mongoose, { Schema, Document, Model } from "mongoose";

interface IWishlistItem {
  productId: mongoose.Types.ObjectId;
  addedAt: Date;
}

interface IWishlist extends Document {
  userId: string;
  items: IWishlistItem[];
  createdAt: Date;
  updatedAt: Date;
}

const WishlistItemSchema = new Schema<IWishlistItem>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const WishlistSchema = new Schema<IWishlist>(
  {
    userId: {
      type: String,
      required: true,
    },
    items: {
      type: [WishlistItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// One wishlist per user, enforced at the DB level: the find-then-create in the
// wishlist route races under concurrency, and duplicate docs made removed
// items "reappear" (reads only ever saw one of the copies).
// NOTE: existing databases may hold duplicates — the index migration script
// dedupes (merges items) before creating this index.
WishlistSchema.index({ userId: 1 }, { unique: true });
// Compound index for faster queries
WishlistSchema.index({ userId: 1, "items.productId": 1 });

export const Wishlist: Model<IWishlist> =
  mongoose.models.Wishlist ||
  mongoose.model<IWishlist>("Wishlist", WishlistSchema);
