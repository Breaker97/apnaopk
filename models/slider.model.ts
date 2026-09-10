import { mongoose } from "@/lib/db";
import {
  DEFAULT_AUTOPLAY_SECONDS,
  MAX_AUTOPLAY_SECONDS,
  MIN_AUTOPLAY_SECONDS,
  type SliderDocument,
} from "@/lib/sliders/types";

const { Schema, models, model } = mongoose;

// Slides are a JSON-shaped array whose contract lives in lib/sliders/types.ts
// (the Menu.items precedent): Mixed here, normalized + validated at the API
// boundary and again on read, so a stored document can never render a value
// the vocabulary doesn't allow.

const SliderSchema = new Schema<SliderDocument>(
  {
    name: {
      type: String,
      required: [true, "Slider name is required"],
      trim: true,
      maxlength: [100, "Slider name cannot exceed 100 characters"],
    },
    handle: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
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
  },
  { timestamps: true },
);

if (models.Slider) {
  delete models.Slider;
}

export const Slider = model<SliderDocument>("Slider", SliderSchema);
