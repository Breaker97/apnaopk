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
  perUserLimit?: number;
  startDate: Date;
  endDate: Date;
  status: CouponStatus;
  vendorId?: mongoose.Types.ObjectId;
  applicableProducts?: mongoose.Types.ObjectId[];
  applicableCategories?: mongoose.Types.ObjectId[];
  excludedProducts?: mongoose.Types.ObjectId[];
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

export const Coupon: Model<ICoupon> =
  mongoose.models.Coupon || mongoose.model<ICoupon>("Coupon", CouponSchema);
