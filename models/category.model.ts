import { mongoose } from "@/lib/db";
import type { ICategory } from "@/types";

const { Schema, models, model } = mongoose;

// Variant option template for a category. Mirrors the product's own
// option/value shape (see product.model.ts) so a product can inherit a
// category's options directly. Categories carry options + values only — no
// per-variant pricing/stock/images.
const CategoryOptionValueSchema = new Schema(
  {
    _id: { type: String, required: true },
    value: { type: String, required: true, trim: true },
    colorCode: { type: String, trim: true },
    position: { type: Number, default: 0 },
  },
  { _id: false }
);

const CategoryOptionSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    values: { type: [CategoryOptionValueSchema], default: [] },
    position: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * Category Schema
 */
const CategorySchema = new Schema<ICategory>(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      maxlength: [100, "Category name cannot exceed 100 characters"],
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
    image: {
      type: String,
    },
    icon: {
      type: String,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    /**
     * The custom sales-tax rate, in percent, of the products filed here (and
     * under its subcategories) that set none of their own. Absent (null) it
     * takes the category's tax class, then the parent's, then the store's; 0
     * makes them tax-free. See lib/tax/tax-rates.ts.
     */
    taxRate: {
      type: Number,
      min: [0, "Tax rate cannot be negative"],
      max: [100, "Tax rate cannot exceed 100%"],
      default: null,
    },
    /** The tax class (Settings → Tax) of the products filed here that set none. */
    taxClass: {
      type: String,
      trim: true,
      maxlength: 40,
      default: null,
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
    seo: {
      pageTitle: {
        type: String,
        maxlength: [70, "SEO page title cannot exceed 70 characters"],
      },
      metaDescription: {
        type: String,
        maxlength: [320, "SEO meta description cannot exceed 320 characters"],
      },
      tags: [{ type: String, trim: true, lowercase: true }],
    },
    productCount: {
      type: Number,
      default: 0,
    },
    options: {
      type: [CategoryOptionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
CategorySchema.index({ parentId: 1 });
CategorySchema.index({ order: 1 });
CategorySchema.index({ isActive: 1 });
CategorySchema.index({ featured: 1 });

// Virtual for subcategories
CategorySchema.virtual("subcategories", {
  ref: "Category",
  localField: "_id",
  foreignField: "parentId",
});

// Virtual for parent category
CategorySchema.virtual("parent", {
  ref: "Category",
  localField: "parentId",
  foreignField: "_id",
  justOne: true,
});

if (models.Category) {
  delete models.Category;
}

export const Category = model<ICategory>("Category", CategorySchema);
