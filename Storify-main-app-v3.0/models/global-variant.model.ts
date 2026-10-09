import { mongoose } from "@/lib/db";
import type { IGlobalVariant } from "@/types";

const { Schema, models, model } = mongoose;

/**
 * Global Variant Schema
 * A reusable variant definition (e.g. "Color", "Storage") that an admin
 * creates once and can attach to any product from the product form, instead
 * of retyping the same option/values for every product.
 */
const GlobalVariantValueSchema = new Schema(
  {
    _id: { type: String, required: true },
    value: { type: String, required: true, trim: true },
    colorCode: { type: String, trim: true },
    image: { type: String, trim: true },
    position: { type: Number, default: 0 },
  },
  { _id: false }
);

const GlobalVariantSchema = new Schema<IGlobalVariant>(
  {
    name: {
      type: String,
      required: [true, "Variant name is required"],
      trim: true,
      maxlength: [100, "Variant name cannot exceed 100 characters"],
    },
    type: {
      type: String,
      enum: ["text", "color", "image", "integer", "decimal"],
      default: "text",
    },
    visual: {
      type: String,
      enum: [
        "rectangle",
        "dropdown",
        "circle",
        "color",
        "color_label",
        "radio",
        "image",
      ],
      default: "rectangle",
    },
    values: {
      type: [GlobalVariantValueSchema],
      default: [],
    },
    position: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

GlobalVariantSchema.index({ position: 1, createdAt: 1 });
GlobalVariantSchema.index({ isActive: 1 });

if (models.GlobalVariant) {
  delete models.GlobalVariant;
}

export const GlobalVariant = model<IGlobalVariant>(
  "GlobalVariant",
  GlobalVariantSchema
);
