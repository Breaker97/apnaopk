import { mongoose } from "@/lib/db";
const { Schema } = mongoose;
const checkpoint = new Schema({
  key: { type: String, required: true, unique: true },
  group: { type: String, required: true },
  source: { type: String, required: true },
  since: { type: Date, required: true },
  until: { type: Date, required: true },
  cursor: { type: Schema.Types.ObjectId, default: null },
  complete: { type: Boolean, default: false },
  generation: { type: Number, default: 1 },
  processed: { type: Number, default: 0 },
  leaseOwner: String,
  leaseUntil: Date,
  lastRunAt: { type: Date, default: () => new Date(0) },
}, { timestamps: true });
checkpoint.index({ group: 1, source: 1, complete: 1, since: 1 });
export const FinanceRecoveryCheckpoint = mongoose.models.FinanceRecoveryCheckpoint || mongoose.model("FinanceRecoveryCheckpoint", checkpoint);
const failure = new Schema({
  key: { type: String, required: true, unique: true },
  source: { type: String, required: true },
  sourceId: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  error: { type: String, maxlength: 2000 },
}, { timestamps: true });
failure.index({ source: 1, nextAttemptAt: 1, _id: 1 });
export const FinanceRecoveryFailure = mongoose.models.FinanceRecoveryFailure || mongoose.model("FinanceRecoveryFailure", failure);
