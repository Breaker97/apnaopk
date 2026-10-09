import { mongoose } from "@/lib/db";
import type { Model } from "mongoose";

const { Schema, models, model } = mongoose;

export type EmailDeliveryStatus =
  | "queued"
  | "sending"
  | "retrying"
  | "sent"
  | "failed"
  /**
   * An admin stopped it before it went out (Settings → Email, "Cancel them"
   * on emails the retry job never reached). Never sent, never retried.
   */
  | "cancelled";

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
   * Extra SMTP headers for this one message, e.g. `List-Unsubscribe` on a
   * marketing send. Held with the job rather than applied at delivery so a
   * retry sends the same message the first attempt did.
   */
  headers?: Record<string, string>;
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
  /**
   * The mail server refused the recipient for good (see `isHardBounce`). Kept
   * apart from `failed`, which also covers a store whose SMTP login lapsed:
   * only this one says the ADDRESS is dead — what a pre-order's advance notice
   * needs to know before any card is charged.
   */
  hardBounce?: boolean;
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
    headers: { type: Schema.Types.Mixed },
    dedupeKey: String,
    status: {
      type: String,
      enum: ["queued", "sending", "retrying", "sent", "failed", "cancelled"],
      default: "queued",
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 4 },
    nextAttemptAt: Date,
    lastAttemptAt: Date,
    sentAt: Date,
    lastError: { type: String, maxlength: 1000 },
    hardBounce: Boolean,
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
