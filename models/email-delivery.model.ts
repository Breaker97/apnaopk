import { mongoose } from "@/lib/db";
import type { Model } from "mongoose";

const { Schema, models, model } = mongoose;

export type EmailDeliveryStatus =
  | "queued"
  | "sending"
  | "retrying"
  | "sent"
  | "failed";

interface IEmailDelivery {
  _id: mongoose.Types.ObjectId;
  to: string;
  subject: string;
  from?: string;
  replyTo?: string;
  html?: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
  category: string;
  /**
   * One email per event per recipient — see `sendEmail`'s `dedupeKey`. Only
   * notifications set it; a password reset or an invite must always go out.
   */
  dedupeKey?: string;
  status: EmailDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: Date;
  lastAttemptAt?: Date;
  sentAt?: Date;
  lastError?: string;
  providerMessageId?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EmailDeliverySchema = new Schema<IEmailDelivery>(
  {
    to: { type: String, required: true, index: true },
    subject: { type: String, required: true, maxlength: 500 },
    from: String,
    replyTo: String,
    html: String,
    text: String,
    attachments: { type: Schema.Types.Mixed },
    category: { type: String, default: "transactional", index: true },
    dedupeKey: String,
    status: {
      type: String,
      enum: ["queued", "sending", "retrying", "sent", "failed"],
      default: "queued",
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 4 },
    nextAttemptAt: Date,
    lastAttemptAt: Date,
    sentAt: Date,
    lastError: { type: String, maxlength: 1000 },
    providerMessageId: String,
    expiresAt: Date,
  },
  { timestamps: true },
);

EmailDeliverySchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
EmailDeliverySchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);
EmailDeliverySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
EmailDeliverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailDelivery = ((models.EmailDelivery as
  | Model<IEmailDelivery>
  | undefined) ??
  model<IEmailDelivery>("EmailDelivery", EmailDeliverySchema)) as Model<IEmailDelivery>;
