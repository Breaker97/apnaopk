import { mongoose } from "@/lib/db";
import type { Types } from "mongoose";
import {
  DEFAULT_AUTOPLAY_SECONDS,
  MAX_AUTOPLAY_SECONDS,
  MIN_AUTOPLAY_SECONDS,
  type SliderDocument,
} from "@/lib/sliders/types";

const { Schema, models, model } = mongoose;

/**
 * A vendor's own slider, built in their Online Store → Sliders and placed on
 * their landing page with the Slider section. The admin's `Slider` documents
 * are the marketplace's and never mix with these: separate collection, and a
 * handle that is unique per vendor rather than store-wide.
 *
 * Same shape and contract as `Slider` (lib/sliders/types.ts): slides are
 * Mixed, normalized at the API boundary and again on read, with a draft
 * beside the live content and the last published versions in `history`.
 */
export type VendorSliderDocument = SliderDocument & {
  vendorId: Types.ObjectId;
};

const VendorSliderSchema = new Schema<VendorSliderDocument>(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Slider name is required"],
      trim: true,
      maxlength: [100, "Slider name cannot exceed 100 characters"],
    },
    handle: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    isActive: { type: Boolean, default: true },
    transition: { type: String, enum: ["slide", "fade"], default: "slide" },
    autoplaySeconds: {
      type: Number,
      default: DEFAULT_AUTOPLAY_SECONDS,
      min: MIN_AUTOPLAY_SECONDS,
      max: MAX_AUTOPLAY_SECONDS,
    },
    slides: { type: Schema.Types.Mixed, default: [] },
    version: { type: Number },
    controls: { type: Schema.Types.Mixed },
    draft: { type: Schema.Types.Mixed },
    history: { type: Schema.Types.Mixed, default: [] },
    publishedAt: { type: String },
  },
  { timestamps: true },
);

VendorSliderSchema.index({ vendorId: 1, handle: 1 }, { unique: true });

if (models.VendorSlider) {
  delete models.VendorSlider;
}

export const VendorSlider = model<VendorSliderDocument>(
  "VendorSlider",
  VendorSliderSchema,
);
