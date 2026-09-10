import { mongoose } from "@/lib/db";
import type { IBlogCategory } from "@/types";

const { Schema, models, model } = mongoose;

const BlogCategorySchema = new Schema<IBlogCategory>(
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
    image: { type: String },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    postCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

BlogCategorySchema.index({ order: 1 });

if (models.BlogCategory) {
  delete models.BlogCategory;
}

export const BlogCategory = model<IBlogCategory>(
  "BlogCategory",
  BlogCategorySchema,
);
