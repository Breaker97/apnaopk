import { mongoose } from "@/lib/db";
import type { Model } from "mongoose";

const { Schema, models, model } = mongoose;

/**
 * `sent` means the provider accepted the message; `delivered`, `undelivered`
 * and a callback's `failed` are the carrier's later verdict, posted back to
 * the delivery-receipt webhook.
 */
export const SMS_DELIVERY_STATUSES = [
  "queued",
  "sending",
  "retrying",
  "sent",
  "delivered",
  "undelivered",
  "failed",
] as const;

export type SmsDeliveryStatus = (typeof SMS_DELIVERY_STATUSES)[number];

/** Nothing more will happen to a row in one of these states on its own. */
export const TERMINAL_SMS_STATUSES: SmsDeliveryStatus[] = [
  "sent",
  "delivered",
  "undelivered",
  "failed",
];

interface ISmsDelivery {
  _id: mongoose.Types.ObjectId;
  /** E.164. */
  to: string;
  body: string;
  category: string;
  /**
   * One text per event per recipient. Set from the notification's own dedupe
   * key, so an event that fires twice — a carrier webhook racing a merchant's
   * manual "mark shipped" — bills one message, not two.
   */
  dedupeKey?: string;
  status: SmsDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: Date;
  lastAttemptAt?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  provider: "twilio";
  providerMessageId?: string;
  /** Billable segments, as the provider counted them. */
  segments?: number;
  errorCode?: string;
  lastError?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SmsDeliverySchema = new Schema<ISmsDelivery>(
  {
    to: { type: String, required: true, index: true },
    body: { type: String, required: true, maxlength: 1600 },
    category: { type: String, default: "notification", index: true },
    dedupeKey: String,
    status: {
      type: String,
      enum: SMS_DELIVERY_STATUSES,
      default: "queued",
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 4 },
    nextAttemptAt: Date,
    lastAttemptAt: Date,
    sentAt: Date,
    deliveredAt: Date,
    provider: { type: String, enum: ["twilio"], default: "twilio" },
    providerMessageId: String,
    segments: Number,
    errorCode: { type: String, maxlength: 20 },
    lastError: { type: String, maxlength: 1000 },
    expiresAt: Date,
  },
  { timestamps: true },
);

SmsDeliverySchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
SmsDeliverySchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);
// How a delivery receipt finds its row.
SmsDeliverySchema.index(
  { providerMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerMessageId: { $type: "string" } },
  },
);
SmsDeliverySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
SmsDeliverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SmsDelivery = ((models.SmsDelivery as
  | Model<ISmsDelivery>
  | undefined) ??
  model<ISmsDelivery>("SmsDelivery", SmsDeliverySchema)) as Model<ISmsDelivery>;
