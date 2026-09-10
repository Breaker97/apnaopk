/**
 * WebhookEvent Model
 * Provider event de-duplication with retry-safe failure tracking.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Every provider whose webhooks share this de-duplication ledger. Carriers are
 * here for the same reason Stripe is: a delivery is retried on any non-2XX and
 * must not be processed twice.
 */
const WEBHOOK_EVENT_PROVIDERS = [
  "stripe",
  "shippo",
  "shiprocket",
] as const;

export type WebhookEventProvider = (typeof WEBHOOK_EVENT_PROVIDERS)[number];

interface IWebhookEvent extends Document {
  provider: WebhookEventProvider;
  eventId: string;
  type: string;
  status: "processing" | "processed" | "failed";
  eventCreatedAt?: Date | null;
  objectId?: string | null;
  attemptCount: number;
  leaseUntil?: Date | null;
  processingStartedAt?: Date | null;
  processedAt?: Date | null;
  lastError?: string | null;
  /**
   * Set only once the event is settled, so the TTL index never reaps a row a
   * worker still holds. Without it the collection grows forever — tolerable
   * while only Stripe wrote to it, not once every carrier scan lands here.
   */
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    provider: {
      type: String,
      enum: WEBHOOK_EVENT_PROVIDERS,
      required: true,
    },
    eventId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["processing", "processed", "failed"],
      default: "processing",
      required: true,
    },
    eventCreatedAt: {
      type: Date,
      default: null,
    },
    objectId: {
      type: String,
      default: null,
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    leaseUntil: {
      type: Date,
      default: null,
    },
    processingStartedAt: {
      type: Date,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
      maxlength: 2000,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
WebhookEventSchema.index({ provider: 1, processedAt: 1 });
WebhookEventSchema.index({ provider: 1, status: 1, leaseUntil: 1 });
// A null expiresAt is never expired, so an in-flight row is safe from the TTL
// monitor; only settled rows carry a date.
WebhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WebhookEvent: Model<IWebhookEvent> =
  mongoose.models.WebhookEvent ||
  mongoose.model<IWebhookEvent>("WebhookEvent", WebhookEventSchema);
