import { mongoose } from "@/lib/db";
const { Schema } = mongoose;
const schema = new Schema({
  key: { type: String, unique: true, required: true },
  orderId: { type: Schema.Types.ObjectId, required: true },
  consignmentId: Schema.Types.ObjectId,
  vendorId: Schema.Types.ObjectId,
  purpose: { type: String, enum: ["checkout", "deposit", "balance", "offline", "cod"], required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true },
  method: { type: String, required: true },
  custodian: { type: String, enum: ["platform", "vendor"], required: true },
  collectedAt: { type: Date, required: true },
  reference: String,
  quality: { type: String, enum: ["recorded", "legacy-estimate"], required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ currency: 1, collectedAt: 1, _id: 1 });
schema.index({ orderId: 1, key: 1 });
export const CollectionReceipt = mongoose.models.CollectionReceipt || mongoose.model("CollectionReceipt", schema);
