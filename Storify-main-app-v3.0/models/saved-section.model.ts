import { mongoose } from "@/lib/db";
import type { Document } from "mongoose";

const { Schema, models, model } = mongoose;

/**
 * Library ceiling. The list endpoint returns at most this many, so allowing
 * more would create entries that can never be seen or deleted from the UI.
 */
export const SAVED_SECTION_LIMIT = 100;

/**
 * A section saved to the admin's library from the page builder, inserted
 * back as a COPY (fresh ids) — never a live reference, so editing a page
 * can't mutate the library and deleting a library entry breaks nothing.
 *
 * `section` is a full SectionInstance, stored Mixed and validated with the
 * registry's write gate on save (the Menu.items / StorePage precedent).
 */
interface ISavedSection extends Document {
  name: string;
  section: unknown;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SavedSectionSchema = new Schema<ISavedSection>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [80, "Name cannot exceed 80 characters"],
    },
    section: { type: Schema.Types.Mixed, required: true },
    createdBy: String,
  },
  { timestamps: true },
);

SavedSectionSchema.index({ updatedAt: -1 });

if (models.SavedSection) {
  delete models.SavedSection;
}

export const SavedSection = model<ISavedSection>(
  "SavedSection",
  SavedSectionSchema,
);
