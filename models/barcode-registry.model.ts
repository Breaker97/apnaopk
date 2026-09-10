import { mongoose } from "@/lib/db";
import type { BarcodeFormat, BarcodeSource } from "@/lib/barcode/standards";

const { Schema, models, model } = mongoose;

interface IBarcodeRegistry {
  value: string;
  valueNormalized: string;
  productId: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId;
  format: BarcodeFormat;
  source?: BarcodeSource;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BarcodeRegistrySchema = new Schema<IBarcodeRegistry>(
  {
    value: { type: String, required: true, trim: true },
    valueNormalized: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    variantId: { type: Schema.Types.ObjectId },
    format: {
      type: String,
      enum: ["ean13", "upca", "gtin14", "code128"],
      required: true,
    },
    source: {
      type: String,
      enum: ["manufacturer", "gs1", "internal"],
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

BarcodeRegistrySchema.index({ productId: 1, variantId: 1 });

export const BarcodeRegistry =
  models.BarcodeRegistry ||
  model<IBarcodeRegistry>("BarcodeRegistry", BarcodeRegistrySchema);

