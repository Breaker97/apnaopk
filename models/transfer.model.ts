import { mongoose } from "@/lib/db";
import {
  TRANSFER_EVENT_TYPES,
  TRANSFER_STATUSES,
} from "@/lib/inventory/transfer-rules";

const { Schema, models, model } = mongoose;

const TransferItemSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    /** Empty for a product without variants, whose stock sits on the product. */
    variantId: {
      type: String,
      trim: true,
      default: "",
    },
    productTitle: {
      type: String,
      required: true,
      trim: true,
    },
    variantTitle: {
      type: String,
      trim: true,
    },
    sku: {
      type: String,
      trim: true,
      uppercase: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    /** Units that arrived and were added to the destination. */
    receivedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Units written off on arrival (damaged, short-shipped, lost). */
    rejectedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false },
);

const TransferEventLineSchema = new Schema(
  {
    productId: { type: String, required: true },
    variantId: { type: String, default: "" },
    accepted: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
  },
  { _id: false },
);

/** One step in a transfer's history — who moved it, when, and what arrived. */
const TransferEventSchema = new Schema({
  type: {
    type: String,
    enum: TRANSFER_EVENT_TYPES,
    required: true,
  },
  at: { type: Date, required: true },
  actorId: { type: String, trim: true },
  actorName: { type: String, trim: true },
  note: { type: String, trim: true, maxlength: 2000 },
  /** Per-line quantities, on `received` entries. */
  lines: { type: [TransferEventLineSchema], default: undefined },
});

const TransferSchema = new Schema(
  {
    transferNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    fromLocationId: {
      type: String,
      required: true,
    },
    fromLocationName: {
      type: String,
      required: true,
      trim: true,
    },
    toLocationId: {
      type: String,
      required: true,
      index: true,
    },
    toLocationName: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: TRANSFER_STATUSES,
      default: "draft",
    },
    items: {
      type: [TransferItemSchema],
      default: [],
      validate: {
        validator: (items: unknown[]) => Array.isArray(items) && items.length > 0,
        message: "At least one transfer item is required",
      },
    },
    note: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    reference: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    createdBy: {
      type: String,
      trim: true,
      index: true,
    },
    /**
     * When the units left the source location. Transfers shipped before stock
     * moved at ship time have none, which is how receiving knows it must take
     * the units out of the source first.
     */
    shippedAt: {
      type: Date,
    },
    /**
     * Held while stock is being moved for this transfer (ship, receive, cancel
     * in transit), so two of those can never run at once and move the same
     * units twice. Left set only if the server died mid-move — a transfer stuck
     * with it needs its stock checked by hand before it is released.
     */
    stockMovementPending: {
      type: Boolean,
    },
    /** When the lock above was taken — how a stuck one is told from a busy one. */
    stockMovementStartedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
    events: {
      type: [TransferEventSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

TransferSchema.index({ createdAt: -1 });
TransferSchema.index({ status: 1, createdAt: -1 });
TransferSchema.index({ fromLocationId: 1, toLocationId: 1, createdAt: -1 });

// Next.js dev hot reload keeps Mongoose's global model cache alive. Recompile
// this model in development so newly-added fields are not silently dropped by a
// stale schema until the server is restarted.
if (process.env.NODE_ENV === "development" && models.Transfer) {
  mongoose.deleteModel("Transfer");
}

export const Transfer = models.Transfer || model("Transfer", TransferSchema);
