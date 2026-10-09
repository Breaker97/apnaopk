/**
 * Idempotency Record Model
 *
 * One request of the shopper app that must not run twice: placing an order,
 * starting a card payment. The app sends an `Idempotency-Key` (a UUID it keeps
 * until it has an answer); the first request with it runs and its answer is
 * kept here, and a retry — the app lost the answer to a dropped connection —
 * gets that same answer instead of a second order. See
 * lib/api-next/idempotency.ts for the rules.
 *
 * `scope` is whose key it is (`user:<id>`, `cart:<token>`, `install:<id>`), so
 * two shoppers can never collide on a key. A record lives a day.
 */

import mongoose, { Schema, Model } from "mongoose";

export const IDEMPOTENCY_STATUS = {
  /** The first request with this key is still running. */
  IN_PROGRESS: "in_progress",
  /** It answered; `response*` is that answer. */
  DONE: "done",
} as const;

type IdempotencyStatus =
  (typeof IDEMPOTENCY_STATUS)[keyof typeof IDEMPOTENCY_STATUS];

interface IIdempotencyRecord {
  scope: string;
  key: string;
  /** The endpoint the key was first used on (`checkout.orders.place`). */
  routeId: string;
  /** sha256 of the parsed request body: a key reused for another body is refused. */
  requestHash: string;
  status: IdempotencyStatus;
  /** When the request now running took the key; a long-dead one is taken over. */
  lockedAt: Date;
  responseStatus?: number;
  /** The answer's JSON, exactly as it was sent. */
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  createdAt: Date;
}

const IdempotencyRecordSchema = new Schema<IIdempotencyRecord>(
  {
    scope: { type: String, required: true },
    key: { type: String, required: true },
    routeId: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(IDEMPOTENCY_STATUS),
      required: true,
    },
    lockedAt: { type: Date, required: true },
    responseStatus: { type: Number },
    responseBody: { type: String },
    responseHeaders: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One record per key per caller: the insert that claims a key is refused
// for the second request by this index.
IdempotencyRecordSchema.index({ scope: 1, key: 1 }, { unique: true });
// A key answers retries for a day.
IdempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const IdempotencyRecord: Model<IIdempotencyRecord> =
  mongoose.models.IdempotencyRecord ||
  mongoose.model<IIdempotencyRecord>("IdempotencyRecord", IdempotencyRecordSchema);
