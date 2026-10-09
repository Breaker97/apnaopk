import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * Work a pre-order lifecycle change still owes after its state changed.
 *
 * Cancelling or expiring a pre-order is one state change and a tail of side
 * effects: stock back on the shelf, reservation places freed, labels voided,
 * the coupon given back, the shopper refunded and told. Run inline after the
 * status write, a crash anywhere in that tail lost the rest for good — and an
 * expired order drops out of the very query that found it, so nothing would
 * ever look at it again. Releasing a paid order for fulfilment has the same
 * shape: allocate, move the consignments, queue the label, tell the shopper.
 *
 * So the change writes one of these in the same transaction as the state it
 * describes, and a worker carries the effects out one at a time, recording
 * each as it lands. `key` makes the operation itself happen once however many
 * requests or sweeps describe it. See `lib/orders/preorder-operations.ts`.
 */

export type PreorderOperationKind = "expire" | "cancel" | "release";

export type PreorderOperationState =
  /** Effects still to run; due at `nextAttemptAt`. */
  | "pending"
  /** A worker holds the lease. */
  | "running"
  /** Blocked on something outside this system (stock, a date propagation). */
  | "waiting"
  | "completed"
  /** A person has to act — named in `reasonCode` and the effect that stopped. */
  | "attention"
  /** Overtaken: the order changed so this work no longer applies. */
  | "superseded";

export type PreorderEffectState =
  | "pending"
  | "done"
  | "skipped"
  | "failed"
  | "attention";

export type PreorderRefundState =
  | "pending"
  /** Sent to the gateway; the answer is not yet recorded. */
  | "submitting"
  | "succeeded"
  /** Nothing had been collected for this scope. */
  | "nothing"
  /** Recorded, but no gateway carried it — a person sends it. */
  | "manual"
  | "failed"
  /** The gateway's answer was lost — reconciled before anything is resent. */
  | "unknown";

export interface IPreorderOperation {
  _id: mongoose.Types.ObjectId;
  key: string;
  kind: PreorderOperationKind;
  orderId: mongoose.Types.ObjectId;
  orderNumber?: string;
  subOrderIds: mongoose.Types.ObjectId[];
  cycleId?: string;
  /** The whole order was cancelled by this change, not just part of it. */
  wholeOrder?: boolean;
  state: PreorderOperationState;
  reasonCode?: string;
  reason?: string;
  /** `system`, or the user who made the change. */
  actor: string;
  /** Their role and address at the time, for the audit trail of the effects. */
  actorRole?: string;
  actorEmail?: string;
  source?: string;
  effects: Array<{
    name: string;
    state: PreorderEffectState;
    attempts: number;
    lastError?: string;
    detail?: string;
    completedAt?: Date;
  }>;
  refund?: {
    state: PreorderRefundState;
    attemptId?: string;
    amount?: number;
    currency?: string;
    gatewayCalled?: boolean;
    startedAt?: Date;
    completedAt?: Date;
    /** `refundedTotal` when this refund was submitted. */
    refundedBefore?: number;
    reason?: string;
  };
  attempts: number;
  lastAttemptAt?: Date;
  nextAttemptAt?: Date;
  leaseOwner?: string;
  leaseUntil?: Date;
  lastError?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PreorderOperationSchema = new Schema<IPreorderOperation>(
  {
    key: { type: String, required: true, trim: true, maxlength: 300 },
    kind: {
      type: String,
      enum: ["expire", "cancel", "release"],
      required: true,
    },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, trim: true },
    subOrderIds: { type: [Schema.Types.ObjectId], default: [] },
    cycleId: { type: String, trim: true },
    wholeOrder: { type: Boolean },
    state: {
      type: String,
      enum: [
        "pending",
        "running",
        "waiting",
        "completed",
        "attention",
        "superseded",
      ],
      required: true,
    },
    reasonCode: { type: String, trim: true, maxlength: 60 },
    reason: { type: String, trim: true, maxlength: 500 },
    actor: { type: String, required: true, trim: true },
    actorRole: { type: String, trim: true, maxlength: 40 },
    actorEmail: { type: String, trim: true, maxlength: 320 },
    source: { type: String, trim: true, maxlength: 60 },
    effects: {
      type: [
        new Schema(
          {
            name: { type: String, required: true },
            state: {
              type: String,
              enum: ["pending", "done", "skipped", "failed", "attention"],
              required: true,
            },
            attempts: { type: Number, default: 0, min: 0 },
            lastError: { type: String, trim: true, maxlength: 500 },
            detail: { type: String, trim: true, maxlength: 500 },
            completedAt: { type: Date },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    refund: {
      type: new Schema(
        {
          state: {
            type: String,
            enum: [
              "pending",
              "submitting",
              "succeeded",
              "nothing",
              "manual",
              "failed",
              "unknown",
            ],
            required: true,
          },
          attemptId: { type: String, trim: true },
          amount: { type: Number, min: 0 },
          currency: { type: String, trim: true, uppercase: true },
          gatewayCalled: { type: Boolean },
          startedAt: { type: Date },
          completedAt: { type: Date },
          refundedBefore: { type: Number },
          reason: { type: String, trim: true, maxlength: 500 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    attempts: { type: Number, default: 0, min: 0 },
    lastAttemptAt: { type: Date },
    nextAttemptAt: { type: Date },
    leaseOwner: { type: String, trim: true },
    leaseUntil: { type: Date },
    lastError: { type: String, trim: true, maxlength: 500 },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

// One operation per described change, whoever describes it first.
PreorderOperationSchema.index({ key: 1 }, { unique: true });
// The worker: due work, oldest due first, `_id` as the tie-break so a pile of
// operations due at the same instant is drained in a stable order.
PreorderOperationSchema.index({ state: 1, nextAttemptAt: 1, _id: 1 });
// The order screens and the migration report read an order's operations.
PreorderOperationSchema.index({ orderId: 1, createdAt: -1 });

export const PreorderOperation: mongoose.Model<IPreorderOperation> =
  (models.PreorderOperation as mongoose.Model<IPreorderOperation>) ||
  model<IPreorderOperation>("PreorderOperation", PreorderOperationSchema);
