/**
 * Login Attempts Model
 *
 * Failure counters behind the admin's "Max login attempts" / "Lockout duration"
 * settings. All the reading and writing lives in `lib/login-lockout.ts`, which
 * owns the policy and does every mutation atomically — nothing should hand-roll
 * a read-modify-write against this collection.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

interface ILoginAttempt extends Document {
  /** `<email>|<client ip>` — see `lib/login-lockout.ts` for why both. */
  identifier: string;
  attempts: number;
  lastAttempt: Date;
  lockedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LoginAttemptSchema = new Schema<ILoginAttempt>(
  {
    identifier: {
      type: String,
      required: true,
      // `unique` already builds the index; declaring `index: true` as well made
      // Mongoose warn about a duplicate on every boot.
      unique: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastAttempt: {
      type: Date,
      default: Date.now,
    },
    lockedUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// TTL index to auto-delete old records after 24 hours
LoginAttemptSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86400 });

export const LoginAttempt: Model<ILoginAttempt> =
  mongoose.models.LoginAttempt ||
  mongoose.model<ILoginAttempt>("LoginAttempt", LoginAttemptSchema);
