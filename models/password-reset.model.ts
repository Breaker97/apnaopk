/**
 * Password Reset Model
 * Store password reset tokens with expiration
 */

import mongoose, { Schema, Document, Model, Types } from "mongoose";
import crypto from "crypto";

/**
 * What a link is for. A reset replaces a password someone forgot; an invite
 * sets the first one, for an account an admin made or a guest being asked to
 * claim theirs. The reset page words itself from this, and the two live side
 * by side: asking for a reset must not kill an invitation still in the inbox.
 */
export const PASSWORD_TOKEN_PURPOSES = ["reset", "invite"] as const;
export type PasswordTokenPurpose = (typeof PASSWORD_TOKEN_PURPOSES)[number];

/**
 * How long each kind of link works. A reset answers something the owner just
 * asked for, so an hour is plenty; an invitation waits in an inbox until
 * someone gets round to it.
 */
export const PASSWORD_TOKEN_LIFETIME_MS: Record<PasswordTokenPurpose, number> = {
  reset: 60 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
};

export interface IPasswordReset extends Document {
  userId: Types.ObjectId;
  token: string; // hashed token
  /** Absent on links made before purposes existed; those were resets. */
  purpose?: PasswordTokenPurpose;
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
    purpose: {
      type: String,
      enum: PASSWORD_TOKEN_PURPOSES,
      default: "reset",
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + PASSWORD_TOKEN_LIFETIME_MS.reset),
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

/**
 * The rows of one purpose. A link made before purposes existed has none and
 * was a reset, so the reset filter takes those in too.
 */
function purposeFilter(
  purpose: PasswordTokenPurpose,
): PasswordTokenPurpose | { $in: Array<PasswordTokenPurpose | null> } {
  return purpose === "reset" ? { $in: ["reset", null] } : purpose;
}

/** What a stored row is for, reading a purpose-less old row as a reset. */
export function tokenPurpose(doc: { purpose?: string | null }): PasswordTokenPurpose {
  return doc.purpose === "invite" ? "invite" : "reset";
}

// Static methods
PasswordResetSchema.statics.createToken = async function (
  userId: Types.ObjectId | string,
  purpose: PasswordTokenPurpose = "reset",
  options: { lifetimeMs?: number } = {},
): Promise<{ token: string; resetDoc: IPasswordReset }> {
  // A new link replaces the older ones of its own kind only: the invitation an
  // admin sent stays good when the shopper also asks for a reset.
  await this.updateMany(
    { userId, used: false, purpose: purposeFilter(purpose) },
    { used: true },
  );

  // Generate a random token
  const rawToken = crypto.randomBytes(32).toString("hex");

  // Create the reset document
  const resetDoc = await this.create({
    userId,
    token: hashToken(rawToken),
    purpose,
    expiresAt: new Date(
      Date.now() + (options.lifetimeMs ?? PASSWORD_TOKEN_LIFETIME_MS[purpose]),
    ),
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

/**
 * Every link of this user's, of either kind, stops working. A password that
 * has just been set makes them all stale: an older invitation or reset still
 * sitting in an inbox would otherwise set it again.
 */
PasswordResetSchema.statics.invalidateAllForUser = async function (
  userId: Types.ObjectId | string,
): Promise<void> {
  await this.updateMany({ userId, used: false }, { $set: { used: true } });
};

interface PasswordResetModel extends Model<IPasswordReset> {
  /**
   * Invalidates the user's earlier tokens of this purpose and issues a fresh
   * raw token, living `PASSWORD_TOKEN_LIFETIME_MS[purpose]` unless the caller
   * sets a lifetime of its own.
   */
  createToken(
    userId: Types.ObjectId | string,
    purpose?: PasswordTokenPurpose,
    options?: { lifetimeMs?: number },
  ): Promise<{ token: string; resetDoc: IPasswordReset }>;
  /** The unused, unexpired reset matching a raw token, or null. */
  verifyToken(rawToken: string): Promise<IPasswordReset | null>;
  /** Marks that reset used and returns it, or null if nothing was left to spend. */
  consumeToken(rawToken: string): Promise<IPasswordReset | null>;
  /** Marks every unused token of the user used, whatever its purpose. */
  invalidateAllForUser(userId: Types.ObjectId | string): Promise<void>;
}

export const PasswordReset: PasswordResetModel =
  (mongoose.models.PasswordReset as PasswordResetModel | undefined) ||
  mongoose.model<IPasswordReset, PasswordResetModel>(
    "PasswordReset",
    PasswordResetSchema,
  );
