import { Schema, model, models } from "mongoose";

/** Permanent domain receipt. Product and receipt commit in the same transaction. */
const schema = new Schema(
  {
    operationId: { type: String, required: true, unique: true },
    productId: { type: Schema.Types.ObjectId, required: true, index: true },
    ownerVendorId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ["create", "save", "delete"], required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    finalized: { type: Boolean, default: false },
    createDraftKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);

export const BizProductWrite =
  models.BizProductWrite || model("BizProductWrite", schema);

/** Serialize capacity checks per owner; no vendor/order schema changes are needed. */
const ownerSchema = new Schema({
  _id: { type: String },
  revision: { type: Number, default: 0 },
});
export const BizProductOwnerLock =
  models.BizProductOwnerLock || model("BizProductOwnerLock", ownerSchema);
