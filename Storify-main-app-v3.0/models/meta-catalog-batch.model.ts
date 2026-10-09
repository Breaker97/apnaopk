import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * A Catalog Batch call Meta is still ingesting: the handle it answered with,
 * and which product each item belongs to, so the item ids Meta later reports
 * as refused land on the right product (lib/meta-catalog/sync-worker.ts).
 * Checked on a widening schedule until Meta says it finished; a handle that
 * never finishes expires with the row.
 */
export interface IMetaCatalogBatch extends mongoose.Document {
  handle: string;
  catalogId: string;
  sentAt: Date;
  nextCheckAt: Date;
  checks: number;
  leaseUntil?: Date;
  items: Array<{ id: string; productId: mongoose.Types.ObjectId; method: "UPDATE" | "DELETE" }>;
  expiresAt: Date;
}

const MetaCatalogBatchSchema = new Schema<IMetaCatalogBatch>(
  {
    handle: { type: String, required: true },
    catalogId: { type: String, required: true },
    sentAt: { type: Date, required: true },
    nextCheckAt: { type: Date, required: true },
    checks: { type: Number, default: 0, min: 0 },
    leaseUntil: { type: Date },
    items: {
      type: [
        new Schema(
          {
            id: String,
            productId: { type: Schema.Types.ObjectId, ref: "Product" },
            method: { type: String, enum: ["UPDATE", "DELETE"] },
          },
          { _id: false, id: false },
        ),
      ],
      default: [],
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "metacatalogbatches" },
);

MetaCatalogBatchSchema.index({ handle: 1 }, { unique: true });
MetaCatalogBatchSchema.index({ nextCheckAt: 1 });
MetaCatalogBatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MetaCatalogBatch: mongoose.Model<IMetaCatalogBatch> =
  (models.MetaCatalogBatch as mongoose.Model<IMetaCatalogBatch>) ||
  model<IMetaCatalogBatch>("MetaCatalogBatch", MetaCatalogBatchSchema);
