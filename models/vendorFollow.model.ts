import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

interface IVendorFollow {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A shopper following a store.
 *
 * A dedicated collection rather than an array on the user (the shape Wishlist
 * uses) because both directions of this relation are queried: "is this shopper
 * following this store" AND "how many followers does this store have". An array
 * answers the first cheaply and the second only by scanning every user, and it
 * grows without bound for anyone who follows a lot of stores.
 */
const VendorFollowSchema = new Schema<IVendorFollow>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
  },
  { timestamps: true },
);

// One follow per shopper per store. Also serves the "am I following?" lookup.
// Relied upon for correctness, not just speed: a double-tap on the Follow button
// races two inserts, and the duplicate-key error is what the route catches to
// make following idempotent.
VendorFollowSchema.index({ userId: 1, vendorId: 1 }, { unique: true });
// Follower counts per store, and the store's follower list newest-first.
VendorFollowSchema.index({ vendorId: 1, createdAt: -1 });

export const VendorFollow =
  models.VendorFollow ||
  model<IVendorFollow>("VendorFollow", VendorFollowSchema);
