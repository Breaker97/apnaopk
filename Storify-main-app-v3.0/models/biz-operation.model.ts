import mongoose, { Schema, type Model } from "mongoose";
import type { StoredBizOperation } from "@/lib/api-core/biz/durable-operation";

type OperationDocument = Omit<StoredBizOperation, "id">;
const BizOperationSchema = new Schema<OperationDocument>({
  actorId: { type: String, required: true }, workspace: { type: String, enum: ["platform", "vendor"], required: true },
  workspaceId: { type: String, required: true }, key: { type: String, required: true }, routeId: { type: String, required: true },
  target: { type: String, required: true }, payloadHash: { type: String, required: true },
  state: { type: String, enum: ["pending", "unknown", "succeeded", "failed"], required: true },
  token: { type: String, required: true }, leaseUntil: { type: Date, required: true },
  resources: { type: [{ kind: String, id: String }], default: [] },
  checkpoint: Schema.Types.Mixed, result: Schema.Types.Mixed, failure: Schema.Types.Mixed,
}, { timestamps: true });
// No TTL: deleting an uncertain/confirmed receipt could permit a second effect.
BizOperationSchema.index({ actorId: 1, key: 1 }, { unique: true });
BizOperationSchema.index({ state: 1, leaseUntil: 1 });
export const BizOperation: Model<OperationDocument> = mongoose.models.BizOperation || mongoose.model<OperationDocument>("BizOperation", BizOperationSchema);
