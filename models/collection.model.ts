import { mongoose } from "@/lib/db";
import type { ICollection, CollectionCondition } from "@/types";

const { Schema, models, model } = mongoose;

/**
 * Collection Condition Schema
 * Defines rules for automated collections
 */
const CollectionConditionSchema = new Schema<CollectionCondition>(
  {
    field: {
      type: String,
      required: true,
      enum: [
        "title",
        "productType",
        "vendor",
        "tag",
        "price",
        "comparePrice",
        "weight",
        "stock",
        "createdAt",
        "category",
      ],
    },
    operator: {
      type: String,
      required: true,
      enum: [
        "equals",
        "not_equals",
        "greater_than",
        "less_than",
        "starts_with",
        "ends_with",
        "contains",
        "not_contains",
        "is_set",
        "is_not_set",
      ],
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
    },
  },
  { _id: false }
);

/**
 * Collection SEO Schema
 */
const CollectionSEOSchema = new Schema(
  {
    pageTitle: { type: String, trim: true, maxlength: 70 },
    metaDescription: { type: String, trim: true, maxlength: 320 },
    handle: { type: String, lowercase: true, trim: true },
  },
  { _id: false }
);

/**
 * Collection Image Schema
 */
const CollectionImageSchema = new Schema(
  {
    url: { type: String, required: true },
    alt: { type: String },
    width: { type: Number },
    height: { type: Number },
  },
  { _id: false }
);

/**
 * Collection Schema
 * Supports both manual and automated collections like Shopify
 */
const CollectionSchema = new Schema<ICollection>(
  {
    title: {
      type: String,
      required: [true, "Collection title is required"],
      trim: true,
      maxlength: [255, "Title cannot exceed 255 characters"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    handle: {
      type: String,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      maxlength: [5000, "Description cannot exceed 5000 characters"],
    },
    descriptionHtml: {
      type: String,
      maxlength: [10000, "HTML description cannot exceed 10000 characters"],
    },
    image: {
      type: CollectionImageSchema,
    },

    // Collection Type
    collectionType: {
      type: String,
      enum: ["manual", "automated"],
      default: "manual",
      required: true,
    },

    // Manual Collection: Product IDs
    products: [
      {
        type: Schema.Types.ObjectId,
        ref: "Product",
      },
    ],

    // Automated Collection: Conditions
    conditions: {
      type: [CollectionConditionSchema],
      default: [],
    },
    conditionMatch: {
      type: String,
      enum: ["all", "any"],
      default: "all",
    },

    // Sorting
    sortOrder: {
      type: String,
      enum: [
        "manual",
        "best-selling",
        "title-asc",
        "title-desc",
        "price-asc",
        "price-desc",
        "created-asc",
        "created-desc",
      ],
      default: "manual",
    },

    // Display position for navigation
    position: {
      type: Number,
      default: 0,
    },

    // Publishing status
    status: {
      type: String,
      enum: ["active", "draft"],
      default: "draft",
    },

    // Publishing channels (like products)
    publishing: {
      onlineStore: { type: Boolean, default: true },
      pointOfSale: { type: Boolean, default: false },
    },

    // SEO
    seo: {
      type: CollectionSEOSchema,
      default: () => ({}),
    },

    // Computed product count
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
CollectionSchema.index({ status: 1 });
CollectionSchema.index({ position: 1 });
CollectionSchema.index({ collectionType: 1 });
CollectionSchema.index({ "publishing.onlineStore": 1 });
CollectionSchema.index({ "publishing.pointOfSale": 1 });
CollectionSchema.index({ title: "text", description: "text" });

// Pre-validate hook for slug/handle normalization
CollectionSchema.pre("validate", function () {
  const doc = this as unknown as ICollection;

  // Normalize handle/slug
  const handle = (doc.seo?.handle || doc.handle || doc.slug || "").trim();
  if (!doc.seo) doc.seo = {};
  if (handle) {
    doc.seo.handle = handle;
    doc.handle = handle;
    doc.slug = handle;
  }
});

export const Collection =
  models.Collection || model<ICollection>("Collection", CollectionSchema);
