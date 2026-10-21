import { mongoose } from "@/lib/db";
import { SCHEMA_VERSION, TEMPLATE_CATEGORIES, TEMPLATE_LOCALES } from "@/lib/invoice-templates/types";

const { Schema, models, model } = mongoose;

/**
 * An Invoice Template: a printable design for an online order's invoice, a
 * POS receipt or a courier sticker (docs/INVOICE_TEMPLATE_BUILDER.md §4.3).
 * One collection for the platform's templates (`vendorId` null) and each
 * vendor's own (Phase 7), the Campaign Banner owner pattern: every query in
 * lib/invoice-templates/service.ts carries the owner.
 *
 * The design (`canvas`, `format`, `elements`) is Mixed, its contract being
 * lib/invoice-templates/schema.ts, which every write goes through.
 */
const InvoiceTemplateSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", default: null },
    /** Fixed after the first save. */
    category: { type: String, enum: TEMPLATE_CATEGORIES, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /**
     * The name as uniqueness compares it: trimmed, inner spaces collapsed,
     * lower case. "Minimal" and " minimal " are one name for one owner and
     * category.
     */
    nameKey: { type: String, required: true },
    /** At most one per owner and category (the partial index below). */
    isDefault: { type: Boolean, default: false },
    presetKey: { type: String },
    locale: { type: String, enum: TEMPLATE_LOCALES, default: "en" },
    canvas: { type: Schema.Types.Mixed, required: true },
    format: { type: Schema.Types.Mixed, required: true },
    elements: { type: [Schema.Types.Mixed], default: [] },
    /** Compare-and-set counter: a save names the version it edited. */
    version: { type: Number, default: 1, min: 1 },
    schemaVersion: { type: Number, default: SCHEMA_VERSION },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true, minimize: false },
);

// One name per owner and category, whatever its case.
InvoiceTemplateSchema.index({ vendorId: 1, category: 1, nameKey: 1 }, { unique: true });
// One default per owner and category: the guarantee "set default" relies on.
InvoiceTemplateSchema.index(
  { vendorId: 1, category: 1 },
  { unique: true, partialFilterExpression: { isDefault: true }, name: "one_default_per_owner_category" },
);

if (models.InvoiceTemplate) {
  delete models.InvoiceTemplate;
}

export const InvoiceTemplate = model("InvoiceTemplate", InvoiceTemplateSchema);
