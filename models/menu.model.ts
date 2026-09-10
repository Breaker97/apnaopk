import { mongoose } from "@/lib/db";
import type { IMenu } from "@/types";

const { Schema, models, model } = mongoose;

// Tree of menu items is stored as a JSON-shaped subdocument tree.
// Mongoose Schema typing can't express the recursive shape cleanly,
// so we use Mixed for items and validate shape in API/Zod layer.

const MenuSchema = new Schema<IMenu>(
  {
    name: {
      type: String,
      required: [true, "Menu name is required"],
      trim: true,
      maxlength: [100, "Menu name cannot exceed 100 characters"],
    },
    handle: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    location: {
      type: String,
      enum: ["header", "header-mega", "footer", "mobile", "sidebar", "custom"],
      default: "custom",
      index: true,
    },
    description: {
      type: String,
      maxlength: 500,
    },
    items: { type: Schema.Types.Mixed, default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

if (models.Menu) {
  delete models.Menu;
}

export const Menu = model<IMenu>("Menu", MenuSchema);
