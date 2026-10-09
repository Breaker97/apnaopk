import mongoose, { Schema, type Model } from "mongoose";
import type { BizUpload, BizUploadRequest } from "@/contracts/mobile/biz/v1/uploads";

export interface StoredBizUpload extends BizUploadRequest {
  actorId: string;
  workspaceId: string;
  ownerVendorId?: string;
  operationId: string;
  digest: string;
  state: "pending" | "ready";
  storageKey?: string;
  private: boolean;
  value?: BizUpload;
}
const schema = new Schema<StoredBizUpload>({
  actorId: { type: String, required: true }, workspaceId: { type: String, required: true }, ownerVendorId: String,
  operationId: { type: String, required: true }, digest: { type: String, required: true },
  purpose: { type: String, required: true }, target: { type: Schema.Types.Mixed, required: true },
  state: { type: String, enum: ["pending", "ready"], required: true },
  storageKey: String, private: { type: Boolean, required: true }, value: Schema.Types.Mixed,
}, { timestamps: true });
schema.index({ operationId: 1 }, { unique: true });
schema.index({ actorId: 1, workspaceId: 1, "target.kind": 1, "target.id": 1 });
export const BizUploadRecord: Model<StoredBizUpload> = mongoose.models.BizUploadRecord || mongoose.model<StoredBizUpload>("BizUploadRecord", schema);
