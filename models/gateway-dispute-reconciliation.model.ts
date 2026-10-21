import { mongoose } from "@/lib/db";
const { Schema } = mongoose;

// No TTL: a terminal decision can be appealed and settlement/fee entries can
// arrive later. "complete" means the last authoritative snapshot was applied.
// "unmatched": the gateway knows the dispute, nothing in this store is its
// payment. "orphaned": the gateway no longer has it (another account or mode).
// Neither is work left to do, so neither holds the cron back.
const dispute = new Schema(
  {
    gateway: {
      type: String,
      enum: ["stripe", "razorpay", "paystack", "paypal"],
      required: true,
    },
    disputeId: { type: String, required: true },
    state: {
      type: String,
      enum: ["pending", "open", "complete", "unmatched", "orphaned"],
      default: "pending",
    },
    reading: Schema.Types.Mixed,
    lastAttemptAt: Date,
    lastSuccessAt: Date,
    nextCheckAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 },
    error: { type: String, maxlength: 2000 },
    /** The admin was told once that no order, boost or plan owns this dispute. */
    unmatchedNoticeAt: Date,
    leaseOwner: String,
    leaseUntil: Date,
  },
  { timestamps: true },
);
dispute.index({ gateway: 1, disputeId: 1 }, { unique: true });
dispute.index({ gateway: 1, nextCheckAt: 1, _id: 1 });
export const GatewayDisputeReconciliation =
  mongoose.models.GatewayDisputeReconciliation ||
  mongoose.model("GatewayDisputeReconciliation", dispute);

const checkpoint = new Schema(
  {
    gateway: { type: String, required: true, unique: true },
    credentialFingerprint: String,
    since: Date,
    until: Date,
    cursor: String,
    offset: { type: Number, default: 0 },
    page: { type: Number, default: 1 },
    itemOffset: { type: Number, default: 0 },
    historyScan: Boolean,
    lastHistoryAt: Date,
    next: String,
    complete: { type: Boolean, default: true },
    legacyCursor: Schema.Types.ObjectId,
    leaseOwner: String,
    leaseUntil: Date,
    lastRunAt: Date,
  },
  { timestamps: true },
);
export const GatewayDisputeCheckpoint =
  mongoose.models.GatewayDisputeCheckpoint ||
  mongoose.model("GatewayDisputeCheckpoint", checkpoint);
