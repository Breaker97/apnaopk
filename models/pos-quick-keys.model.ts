import { mongoose } from "@/lib/db";
import type { Model } from "mongoose";

const { Schema, models, model } = mongoose;

/**
 * A merchant's quick keys: the products a till shows on its Favourites tab,
 * in order — the coffee, the carrier bag, the bestseller — so the counter
 * rings them up in one tap instead of a search. One list per merchant
 * (`vendorId`, "" for the store's own registers), shared by every till that
 * sells for it. See lib/pos/quick-keys.ts.
 */
export interface IPosQuickKeys {
  _id: mongoose.Types.ObjectId;
  vendorId: string;
  keys: Array<{ productId: mongoose.Types.ObjectId }>;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PosQuickKeysSchema = new Schema<IPosQuickKeys>(
  {
    vendorId: { type: String, default: "" },
    keys: {
      type: [new Schema({ productId: { type: Schema.Types.ObjectId, ref: "Product", required: true } }, { _id: false })],
      default: [],
    },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: "pos_quick_keys" },
);

PosQuickKeysSchema.index({ vendorId: 1 }, { unique: true });

export const PosQuickKeys = ((models.PosQuickKeys as Model<IPosQuickKeys> | undefined) ??
  model<IPosQuickKeys>("PosQuickKeys", PosQuickKeysSchema)) as Model<IPosQuickKeys>;
