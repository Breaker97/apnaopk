/**
 * Password Reset Model
 * Store password reset tokens with expiration
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";
import crypto from "crypto";

interface IPasswordReset extends Document {
  userId: Types.ObjectId;
  token: string; // hashed token
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

const PasswordResetSchema = new Schema<IPasswordReset>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    },
    used: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// TTL index to auto-delete expired tokens after 24 hours
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

/** Only a token's hash is stored; the raw token lives in the emailed link. */
function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Static methods
PasswordResetSchema.statics.createToken = async function (
  userId: Types.ObjectId | string,
): Promise<{ token: string; resetDoc: IPasswordReset }> {
  // Invalidate any existing tokens for this user
  await this.updateMany({ userId, used: false }, { used: true });

  // Generate a random token
  const rawToken = crypto.randomBytes(32).toString("hex");

  // Create the reset document
  const resetDoc = await this.create({
    userId,
    token: hashToken(rawToken),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
  });

  // Return the raw token (to be sent to user) and the document
  return { token: rawToken, resetDoc };
};

PasswordResetSchema.statics.verifyToken = async function (
  rawToken: string,
): Promise<IPasswordReset | null> {
  return this.findOne({
    token: hashToken(rawToken),
    used: false,
    expiresAt: { $gt: new Date() },
  });
};

/**
 * Spends a raw token: marks the matching unused, unexpired reset used and
 * returns it, in one step. Checking and marking were two, so two requests
 * racing with the same link could both pass the check and both set a
 * password.
 */
PasswordResetSchema.statics.consumeToken = async function (
  rawToken: string,
): Promise<IPasswordReset | null> {
  return this.findOneAndUpdate(
    {
      token: hashToken(rawToken),
      used: false,
      expiresAt: { $gt: new Date() },
    },
    { $set: { used: true } },
    { returnDocument: "after" },
  );
};

interface PasswordResetModel extends Model<IPasswordReset> {
  /** Invalidates the user's earlier tokens and issues a fresh raw token. */
  createToken(
    userId: Types.ObjectId | string,
  ): Promise<{ token: string; resetDoc: IPasswordReset }>;
  /** The unused, unexpired reset matching a raw token, or null. */
  verifyToken(rawToken: string): Promise<IPasswordReset | null>;
  /** Marks that reset used and returns it, or null if nothing was left to spend. */
  consumeToken(rawToken: string): Promise<IPasswordReset | null>;
}

export const PasswordReset: PasswordResetModel =
  (mongoose.models.PasswordReset as PasswordResetModel | undefined) ||
  mongoose.model<IPasswordReset, PasswordResetModel>(
    "PasswordReset",
    PasswordResetSchema,
  );
