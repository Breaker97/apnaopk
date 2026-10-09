import { mongoose } from "@/lib/db";
const { Schema } = mongoose;

const schema = new Schema({
  key: { type: String, required: true, unique: true },
  fingerprint: { type: String, required: true },
  actorId: { type: String, required: true },
  action: { type: String, required: true },
  sourceId: { type: String },
  vendorId: { type: Schema.Types.ObjectId, index: true },
  occurredAt: { type: Date, required: true },
  postings: { type: [Schema.Types.Mixed], default: [] },
  result: { type: Schema.Types.Mixed, required: true },
  state: { type: String, enum: ["pending", "complete", "conflict"], default: "pending" },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  error: { type: String, maxlength: 2000 },
  leaseOwner: { type: String },
  leaseUntil: { type: Date },
}, { timestamps: true });
schema.index({ state: 1, nextAttemptAt: 1, _id: 1 });
schema.index({ sourceId: 1, createdAt: 1 });
export const FinanceOperation = mongoose.models.FinanceOperation || mongoose.model("FinanceOperation", schema);

const vendorStateSchema = new Schema({
  _id: { type: String, required: true },
  version: { type: Number, default: 0 },
}, { timestamps: true });
export const FinanceVendorState = mongoose.models.FinanceVendorState || mongoose.model("FinanceVendorState", vendorStateSchema);
