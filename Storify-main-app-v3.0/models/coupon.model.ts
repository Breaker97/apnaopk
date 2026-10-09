/**
 * Coupon Model
 * Discount coupons and promotional codes
 */

import mongoose, { Schema, Document, Model } from "mongoose";

export enum CouponType {
  PERCENTAGE = "percentage",
  FIXED = "fixed",
  FREE_SHIPPING = "free_shipping",
}

export enum CouponStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  EXPIRED = "expired",
}

/** Where a code the store made itself came from. */
export const COUPON_SOURCE = {
  /** A vendor's discount to a shopper who abandoned a checkout with its goods. */
  ABANDONED_OFFER: "abandoned_offer",
} as const;

/**
 * The codes merchants made: what every Discounts list, its counts and the
 * store-page coupon picker read. The store's own one-off codes stay out.
 */
export const MERCHANT_COUPON_FILTER = {
  source: { $ne: COUPON_SOURCE.ABANDONED_OFFER },
} as const;

interface ICoupon extends Document {
  code: string;
  label?: string;
  description?: string;
  type: CouponType;
  value: number;
  minOrderAmount?: number;
  maxDiscount?: number;
  usageLimit?: number;
  usedCount: number;
  /** Uses kept for checkouts still taking payment: hold key → when it lapses. */
  holds?: Map<string, Date>;
  perUserLimit?: number;
  startDate: Date;
  endDate: Date;
  status: CouponStatus;
  vendorId?: mongoose.Types.ObjectId;
  /** Who pays for the discount — see the schema. */
  fundedBy?: "platform" | "vendor";
  applicableProducts?: mongoose.Types.ObjectId[];
  applicableCategories?: mongoose.Types.ObjectId[];
  excludedProducts?: mongoose.Types.ObjectId[];
  listed?: boolean;
  /** Set on a code the store made itself — see `COUPON_SOURCE`. */
  source?: (typeof COUPON_SOURCE)[keyof typeof COUPON_SOURCE];
  /** The abandoned checkout an offer code was made for. */
  abandonedCheckoutId?: mongoose.Types.ObjectId;
  /** Only this shopper may use it: their checkout email, lower-cased. */
  restrictedToEmail?: string;
  /** ...or their account, when they were signed in. */
  restrictedToUserId?: mongoose.Types.ObjectId;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CouponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: [true, "Coupon code is required"],
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: [20, "Code cannot exceed 20 characters"],
    },
    label: {
      type: String,
      trim: true,
      maxlength: [80, "Label cannot exceed 80 characters"],
    },
    description: {
      type: String,
      maxlength: [200, "Description cannot exceed 200 characters"],
    },
    type: {
      type: String,
      enum: Object.values(CouponType),
      required: true,
      default: CouponType.PERCENTAGE,
    },
    value: {
      type: Number,
      required: [true, "Discount value is required"],
      min: [0, "Value must be positive"],
    },
    minOrderAmount: {
      type: Number,
      default: 0,
    },
    maxDiscount: {
      type: Number,
      default: null,
    },
    usageLimit: {
      type: Number,
      default: null,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    // A use kept for each checkout that has not paid yet, so a limited coupon
    // cannot be handed to more shoppers than it has uses. Keyed by shopper and
    // lapsing on its own — see `holdCouponUse`. Never selected by default: the
    // keys identify shoppers, and coupon lists reach vendors.
    holds: {
      type: Map,
      of: Date,
      default: undefined,
      select: false,
    },
    perUserLimit: {
      type: Number,
      default: 1,
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(CouponStatus),
      default: CouponStatus.ACTIVE,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
    /**
     * Who pays for the goods discount on a seller's items: the store, or the
     * sellers whose items it discounts.
     *
     * The marketplace convention: a seller's own coupon is that seller's cost,
     * a store-wide promotion is the store's. Before this every coupon came out
     * of the sellers' earnings — a site-wide 10% promotion was paid ninety
     * percent by vendors who never chose to run it.
     *
     * Only a store coupon reads it; a vendor's own coupon is always the
     * vendor's, whatever is stored. Absent means the store. Frozen onto each
     * order at checkout (`order.coupon.fundedBy`), so changing it later moves
     * no money on orders already placed.
     *
     * A free-shipping coupon reads it too, on the delivery charge instead of
     * the goods: a store-wide "free delivery this weekend" used to come out of
     * the sellers who carried the parcels, for a promotion they never chose to
     * run. Funded by the store, a seller still earns the charge their parcel
     * was rated at.
     */
    fundedBy: {
      type: String,
      enum: ["platform", "vendor"],
    },
    applicableProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    applicableCategories: [
      {
        type: Schema.Types.ObjectId,
        ref: "Category",
      },
    ],
    excludedProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    /**
     * Offered to shoppers: the shopper app's coupon list (GET /coupons) shows
     * it. Off by default, so a code the store hands out privately (an
     * influencer's, a win-back email's) is never shown to everybody; it still
     * works when typed.
     */
    listed: {
      type: Boolean,
      default: false,
    },
    /**
     * A code the store made itself rather than a merchant typing it in: a
     * vendor's offer to a shopper who left its goods in a checkout. Kept out
     * of every Discounts list, count and picker (`MERCHANT_COUPON_FILTER`) —
     * one is made per offer, and they are nobody's to edit or advertise.
     */
    source: {
      type: String,
      enum: Object.values(COUPON_SOURCE),
    },
    abandonedCheckoutId: {
      type: Schema.Types.ObjectId,
      ref: "AbandonedCheckout",
    },
    /**
     * Who may use the code: the shopper it was sent to, by the email they
     * gave at checkout or by their account. Checked by
     * `assertCouponOpenToShopper`; anyone else is told the code is invalid.
     */
    restrictedToEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    restrictedToUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    createdBy: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
// Admin/vendor coupon lists filter by status or vendorId and sort by createdAt;
// the compounds avoid an in-memory sort and supersede the old single-field
// { status } / { vendorId } (code lookups use the unique `code` index above).
CouponSchema.index({ status: 1, createdAt: -1 });
CouponSchema.index({ endDate: 1 });
CouponSchema.index({ vendorId: 1, createdAt: -1 });
// The shopper app's coupon list: the listed, active ones.
CouponSchema.index({ listed: 1, status: 1, endDate: 1 });

// Virtual to check if coupon is valid
CouponSchema.virtual("isValid").get(function () {
  const now = new Date();
  const usageLimit = this.usageLimit;
  return (
    this.status === CouponStatus.ACTIVE &&
    this.startDate <= now &&
    this.endDate >= now &&
    (usageLimit === null ||
      usageLimit === undefined ||
      this.usedCount < usageLimit)
  );
});

// A dev session that cached the schema before the offer fields existed would
// silently drop them on write — an offer code anyone could use.
if (
  mongoose.models.Coupon &&
  !mongoose.models.Coupon.schema.path("restrictedToEmail")
) {
  delete mongoose.models.Coupon;
}

export const Coupon: Model<ICoupon> =
  mongoose.models.Coupon || mongoose.model<ICoupon>("Coupon", CouponSchema);
