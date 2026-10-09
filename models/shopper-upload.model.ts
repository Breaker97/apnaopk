/**
 * Shopper Upload Model
 *
 * A photo a shopper uploaded from the app (POST /uploads), so it can be
 * named by id afterwards: on a review, or as their profile picture. The file
 * itself is in the store's media storage like any upload; this row says whose
 * it is, so one shopper can never attach another's file by guessing a URL.
 */

import mongoose, { Schema, Model } from "mongoose";

export interface IShopperUpload {
  userId: string;
  url: string;
  key: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: Date;
}

const ShopperUploadSchema = new Schema<IShopperUpload>(
  {
    userId: { type: String, required: true },
    url: { type: String, required: true },
    key: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Every read is "these ids, if they are this shopper's".
ShopperUploadSchema.index({ userId: 1, createdAt: -1 });

export const ShopperUpload: Model<IShopperUpload> =
  mongoose.models.ShopperUpload ||
  mongoose.model<IShopperUpload>("ShopperUpload", ShopperUploadSchema);
