import mongoose, { Schema, type Model } from "mongoose";

export interface StoredBizQuote {
  tokenHash: string;
  actorId: string;
  workspaceId: string;
  purpose: "manual_order" | "refund";
  target: string;
  requestHash: string;
  snapshot: Record<string, unknown>;
  expiresAt: Date;
  operationId?: string;
}
const schema = new Schema<StoredBizQuote>({
  tokenHash: { type: String, required: true }, actorId: { type: String, required: true },
  workspaceId: { type: String, required: true }, purpose: { type: String, enum: ["manual_order", "refund"], required: true },
  target: { type: String, required: true }, requestHash: { type: String, required: true },
  snapshot: { type: Schema.Types.Mixed, required: true }, expiresAt: { type: Date, required: true }, operationId: String,
}, { timestamps: true });
schema.index({ tokenHash: 1 }, { unique: true });
// Quotes expire for authorization but claimed receipts are retained for reconciliation.
schema.index({ expiresAt: 1 });
export const BizQuote: Model<StoredBizQuote> = mongoose.models.BizQuote || mongoose.model<StoredBizQuote>("BizQuote", schema);
