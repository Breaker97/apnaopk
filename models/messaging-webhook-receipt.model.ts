import mongoose, { Schema, type Document, type Model } from "mongoose";
export interface IMessagingWebhookReceipt extends Document {
  /** Which webhook surface delivered this; each has its own event keyspace. */
  provider: "meta" | "telegram";
  eventKey: string;
  payloadHash: string;
  status: "processing" | "processed" | "failed";
  attempts: number;
  processedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MessagingWebhookReceiptSchema =
  new Schema<IMessagingWebhookReceipt>(
    {
      provider: { type: String, enum: ["meta", "telegram"], required: true },
      eventKey: { type: String, required: true, maxlength: 200 },
      payloadHash: { type: String, required: true, minlength: 64, maxlength: 64 },
      status: {
        type: String,
        enum: ["processing", "processed", "failed"],
        required: true,
        default: "processing",
      },
      attempts: { type: Number, required: true, default: 1, min: 1 },
      processedAt: Date,
      lastError: { type: String, maxlength: 2000 },
    },
    { timestamps: true },
  );

MessagingWebhookReceiptSchema.index(
  { provider: 1, eventKey: 1 },
  { unique: true },
);
MessagingWebhookReceiptSchema.index({ status: 1, updatedAt: 1 });
// Receipts exist only to deduplicate Meta's redeliveries, which stop well
// inside a week. Without a TTL this collection grows forever — WhatsApp alone
// posts a separate status callback for sent, delivered and read per message.
MessagingWebhookReceiptSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 },
);

export const MessagingWebhookReceipt: Model<IMessagingWebhookReceipt> =
  mongoose.models.MessagingWebhookReceipt ||
  mongoose.model<IMessagingWebhookReceipt>(
    "MessagingWebhookReceipt",
    MessagingWebhookReceiptSchema,
  );
