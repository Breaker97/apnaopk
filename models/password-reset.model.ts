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
  /** Marks the token consumed so it cannot be replayed. */
  markUsed(): Promise<void>;
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

// Methods
PasswordResetSchema.methods.isValid = function (): boolean {
  if (this.used) return false;
  return new Date() < this.expiresAt;
};

PasswordResetSchema.methods.markUsed = async function (): Promise<void> {
  this.used = true;
  await this.save();
};

// Static methods
PasswordResetSchema.statics.createToken = async function (
  userId: Types.ObjectId | string,
): Promise<{ token: string; resetDoc: IPasswordReset }> {
  // Invalidate any existing tokens for this user
  await this.updateMany({ userId, used: false }, { used: true });

  // Generate a random token
  const rawToken = crypto.randomBytes(32).toString("hex");

  // Hash the token for storage
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  // Create the reset document
  const resetDoc = await this.create({
    userId,
    token: hashedToken,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
  });

  // Return the raw token (to be sent to user) and the document
  return { token: rawToken, resetDoc };
};

PasswordResetSchema.statics.verifyToken = async function (
  rawToken: string,
): Promise<IPasswordReset | null> {
  // Hash the provided token
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  // Find the matching reset document
  const resetDoc = await this.findOne({
    token: hashedToken,
    used: false,
    expiresAt: { $gt: new Date() },
  });

  return resetDoc;
};

interface PasswordResetModel extends Model<IPasswordReset> {
  /** Invalidates the user's earlier tokens and issues a fresh raw token. */
  createToken(
    userId: Types.ObjectId | string,
  ): Promise<{ token: string; resetDoc: IPasswordReset }>;
  /** The unused, unexpired reset matching a raw token, or null. */
  verifyToken(rawToken: string): Promise<IPasswordReset | null>;
}

export const PasswordReset: PasswordResetModel =
  (mongoose.models.PasswordReset as PasswordResetModel | undefined) ||
  mongoose.model<IPasswordReset, PasswordResetModel>(
    "PasswordReset",
    PasswordResetSchema,
  );
