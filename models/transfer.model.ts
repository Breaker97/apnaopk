import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

const TRANSFER_STATUSES = [
  "draft",
  "ready_to_ship",
  "in_transit",
  "completed",
  "cancelled",
] as const;

const TransferItemSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    variantId: {
      type: String,
      required: true,
      trim: true,
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
  },
  { _id: false },
);

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
    completedAt: {
      type: Date,
    },
    cancelledAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

TransferSchema.index({ createdAt: -1 });
TransferSchema.index({ status: 1, createdAt: -1 });
TransferSchema.index({ fromLocationId: 1, toLocationId: 1, createdAt: -1 });

export const Transfer = models.Transfer || model("Transfer", TransferSchema);
