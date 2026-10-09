/**
 * The account email queue: "set your password" links sent to many people at
 * once — every customer with a tag, a page of selected customers, and later
 * the people a customer or vendor import brings in.
 *
 * One job row per recipient, so each is retried, throttled and reported on its
 * own, and one batch row per send, which the progress line reads. The worker
 * (lib/auth/account-email-queue.ts) mints each link just before its email
 * goes out, so a one-hour reset link cannot run out while it waits its turn.
 */

import mongoose, { Schema, type Model } from "mongoose";
import type { PasswordTokenPurpose } from "@/models/password-reset.model";

export const ACCOUNT_EMAIL_SKIP_REASONS = [
  /** An admin's, a team member's or a seller's login. */
  "nonCustomer",
  "banned",
  "inactive",
  /** A guest known only by a phone number, or a profile whose account is gone. */
  "noEmail",
  /** Got an account email in the last 15 minutes, or one is already queued. */
  "recent",
  /** The same person twice in one send: their account row and an old guest row. */
  "duplicate",
] as const;

export type AccountEmailSkipReason = (typeof ACCOUNT_EMAIL_SKIP_REASONS)[number];
export type AccountEmailSkipCounts = Partial<Record<AccountEmailSkipReason, number>>;

export type AccountEmailBatchStatus = "running" | "done";

/**
 * Who the links are for. Absent means customers — every send from the
 * customers screen. "vendor" is a vendor import's store owners: their email
 * says their store has moved, and the customers screen never reports on them.
 */
export type AccountEmailAudience = "customer" | "vendor";

export interface IAccountEmailBatch {
  _id: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  requestedByEmail?: string;
  /**
   * Picked rows, everyone a list filter matched (rebuilt on the server), or
   * the people an import just brought in.
   */
  source: "selection" | "filter" | "import";
  audience?: AccountEmailAudience;
  /** The list filter, for "filter" sends — what the audit row records too. */
  filter?: Record<string, unknown>;
  status: AccountEmailBatchStatus;
  /** Job rows written. */
  queued: number;
  sent: number;
  failed: number;
  /** Turned out ineligible when their turn came (banned since, say). */
  skipped: number;
  /** Left out before anything was queued, by reason. */
  skippedAtStart: AccountEmailSkipCounts;
  finishedAt?: Date | null;
  /** Set when the batch finishes, so the TTL never reaps one still sending. */
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const SkipCountsSchema = new Schema(
  Object.fromEntries(
    ACCOUNT_EMAIL_SKIP_REASONS.map((reason) => [reason, { type: Number, min: 0 }]),
  ),
  { _id: false },
);

const AccountEmailBatchSchema = new Schema<IAccountEmailBatch>(
  {
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestedByEmail: { type: String },
    source: { type: String, enum: ["selection", "filter", "import"], required: true },
    audience: { type: String, enum: ["customer", "vendor"] },
    filter: { type: Schema.Types.Mixed, default: undefined },
    status: {
      type: String,
      enum: ["running", "done"],
      default: "running",
      required: true,
    },
    queued: { type: Number, default: 0, min: 0 },
    sent: { type: Number, default: 0, min: 0 },
    failed: { type: Number, default: 0, min: 0 },
    skipped: { type: Number, default: 0, min: 0 },
    skippedAtStart: { type: SkipCountsSchema, default: () => ({}) },
    finishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

AccountEmailBatchSchema.index({ status: 1, createdAt: -1 });
AccountEmailBatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AccountEmailJobStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "skipped";

export interface IAccountEmailJob {
  _id: mongoose.Types.ObjectId;
  batchId: mongoose.Types.ObjectId;
  /** The customer row it came from, when it came from one. */
  profileId?: mongoose.Types.ObjectId | null;
  /** As on the batch; absent means a customer. */
  audience?: AccountEmailAudience;
  /**
   * The account the link is for. Absent for a guest who has none yet: the
   * worker makes it — without a password and without a second customer row —
   * when the guest's turn comes.
   */
  userId?: mongoose.Types.ObjectId | null;
  /** Lower-cased; what the 15-minute rule and "already queued" read. */
  email: string;
  locale?: string;
  status: AccountEmailJobStatus;
  attempts: number;
  nextAttemptAt: Date;
  /** Crash recovery: an expired lease frees the job for another worker. */
  leaseUntil?: Date | null;
  /** When an email was last handed to the mail server — what the per-minute throttle counts. */
  lastAttemptAt?: Date | null;
  /** What was sent: chosen from the account when the email went out. */
  purpose?: PasswordTokenPurpose;
  skipReason?: AccountEmailSkipReason | "missing";
  /** The mail server's answer, sanitized. Never holds the link. */
  lastError?: string | null;
  /** The address was refused outright; a retry would be refused too. */
  hardBounce?: boolean;
  /** Set only on a terminal state, so the TTL never reaps live work. */
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AccountEmailJobSchema = new Schema<IAccountEmailJob>(
  {
    batchId: {
      type: Schema.Types.ObjectId,
      ref: "AccountEmailBatch",
      required: true,
    },
    profileId: { type: Schema.Types.ObjectId, ref: "CustomerProfile", default: null },
    audience: { type: String, enum: ["customer", "vendor"] },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    locale: { type: String },
    status: {
      type: String,
      enum: ["pending", "processing", "sent", "failed", "skipped"],
      default: "pending",
      required: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: () => new Date(), required: true },
    leaseUntil: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
    purpose: { type: String, enum: ["reset", "invite"] },
    skipReason: { type: String },
    lastError: { type: String, default: null, maxlength: 2000 },
    hardBounce: { type: Boolean },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The claim query.
AccountEmailJobSchema.index({ status: 1, nextAttemptAt: 1 });
AccountEmailJobSchema.index({ batchId: 1, status: 1 });
// "Already queued for this address" when the next send is put together.
AccountEmailJobSchema.index({ email: 1, status: 1 });
// The per-minute throttle.
AccountEmailJobSchema.index({ lastAttemptAt: 1 });
AccountEmailJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AccountEmailBatch: Model<IAccountEmailBatch> =
  mongoose.models.AccountEmailBatch ||
  mongoose.model<IAccountEmailBatch>("AccountEmailBatch", AccountEmailBatchSchema);

export const AccountEmailJob: Model<IAccountEmailJob> =
  mongoose.models.AccountEmailJob ||
  mongoose.model<IAccountEmailJob>("AccountEmailJob", AccountEmailJobSchema);
