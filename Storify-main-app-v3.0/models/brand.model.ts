import { mongoose } from "@/lib/db";
import type { IBrand } from "@/types";

const { Schema, models, model } = mongoose;

/**
 * Brand Schema
 * Flat taxonomy used to group products by manufacturer/brand.
 */
const BrandSchema = new Schema<IBrand>(
  {
    name: {
      type: String,
      required: [true, "Brand name is required"],
      trim: true,
      maxlength: [100, "Brand name cannot exceed 100 characters"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    logo: {
      type: String,
    },
    website: {
      type: String,
      trim: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    featured: {
      type: Boolean,
      default: false,
    },
    ownerVendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },
    approvalStatus: {
      type: String,
      enum: ["approved", "pending", "rejected"],
      default: "approved",
      index: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [1000, "Rejection reason cannot exceed 1000 characters"],
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    seo: {
      pageTitle: {
        type: String,
        maxlength: [70, "SEO page title cannot exceed 70 characters"],
      },
      metaDescription: {
        type: String,
        maxlength: [320, "SEO meta description cannot exceed 320 characters"],
      },
    },
    productCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
BrandSchema.index({ order: 1 });
BrandSchema.index({ isActive: 1 });
BrandSchema.index({ featured: 1 });

if (models.Brand) {
  delete models.Brand;
}

export const Brand = model<IBrand>("Brand", BrandSchema);
