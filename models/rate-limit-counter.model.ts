import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Rate Limit Counter
 *
 * One document per (identifier, window). Backs the shared rate limiter so a
 * limit means the same thing no matter which app instance answers the request
 * — an in-process counter multiplies the effective limit by the number of
 * instances and lets a caller dodge it by landing on a different one.
 *
 * Documents are disposable: the TTL index below reaps them once their window
 * has passed, so the collection stays roughly "active windows" in size and
 * needs no cleanup job.
 */

interface IRateLimitCounter extends Document {
  /** `<identifier>:<window start>` — unique per caller per window. */
  key: string;
  count: number;
  /** When this window ends; also drives expiry. */
  resetAt: Date;
}

const RateLimitCounterSchema = new Schema<IRateLimitCounter>(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false },
);

// Mongo's TTL monitor runs about once a minute, so a document can outlive
// `resetAt` briefly. That is harmless: every read compares against `resetAt`
// itself and treats an elapsed window as empty.
RateLimitCounterSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitCounter: Model<IRateLimitCounter> =
  mongoose.models.RateLimitCounter ||
  mongoose.model<IRateLimitCounter>("RateLimitCounter", RateLimitCounterSchema);
