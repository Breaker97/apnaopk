import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * One product's place in the Meta live sync (lib/meta-catalog/sync-worker.ts).
 *
 * `items` is what Meta was last sent for the product — each item id with the
 * hash of the fields sent — so the worker can tell an item that changed
 * (UPDATE), one that is new (UPDATE, which creates it), and one that is gone
 * (DELETE) without asking Meta. `dirty` + `nextAttemptAt` are the queue: a
 * change marks the row, the first mark sets when it is sent, and later marks
 * before then ride along (lib/meta-catalog/sync-marks.ts). `leaseUntil` is set
 * only while a worker holds the row.
 */
export interface IMetaCatalogSync extends mongoose.Document {
  productId: mongoose.Types.ObjectId;
  dirty: boolean;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  claimId?: string;
  /** Failed tries in a row; a send Meta takes resets it. */
  attempts: number;
  lastError?: string;
  lastAttemptAt?: Date;
  lastSentAt?: Date;
  items: Array<{ id: string; hash: string }>;
  /** Items Meta refused, with its reason. (`errors` is a reserved Mongoose path.) */
  itemErrors: Array<{ itemId: string; message: string; at: Date }>;
  errorCount: number;
  lastErrorAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MetaCatalogSyncSchema = new Schema<IMetaCatalogSync>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    dirty: { type: Boolean, default: true },
    nextAttemptAt: { type: Date, default: Date.now, required: true },
    leaseUntil: { type: Date },
    claimId: { type: String },
    attempts: { type: Number, default: 0, min: 0 },
    lastError: { type: String, maxlength: 1000 },
    lastAttemptAt: { type: Date },
    lastSentAt: { type: Date },
    items: {
      type: [new Schema({ id: String, hash: String }, { _id: false, id: false })],
      default: [],
    },
    itemErrors: {
      type: [
        new Schema(
          { itemId: String, message: { type: String, maxlength: 1000 }, at: Date },
          { _id: false },
        ),
      ],
      default: [],
    },
    errorCount: { type: Number, default: 0, min: 0 },
    lastErrorAt: { type: Date },
  },
  { timestamps: true, collection: "metacatalogsyncs" },
);

// One row per product: two marks racing to create it must meet on the same row.
MetaCatalogSyncSchema.index({ productId: 1 }, { unique: true });
// The worker's claim: due rows, oldest first.
MetaCatalogSyncSchema.index({ dirty: 1, nextAttemptAt: 1 });
// A worker that died holding rows: its leases run out and the rows go back.
MetaCatalogSyncSchema.index({ leaseUntil: 1 }, { sparse: true });
// The page's list of products Meta refused, newest first.
MetaCatalogSyncSchema.index({ errorCount: 1, lastErrorAt: -1 });

export const MetaCatalogSync: mongoose.Model<IMetaCatalogSync> =
  (models.MetaCatalogSync as mongoose.Model<IMetaCatalogSync>) ||
  model<IMetaCatalogSync>("MetaCatalogSync", MetaCatalogSyncSchema);
