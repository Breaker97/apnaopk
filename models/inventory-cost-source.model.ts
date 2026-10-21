import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
const schema = new Schema({
  key: { type: String, required: true, immutable: true }, ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  orderId: { type: Schema.Types.ObjectId, required: true, immutable: true }, subOrderId: { type: Schema.Types.ObjectId, required: true, immutable: true }, lineId: { type: String, required: true, immutable: true },
  expenseId: { type: Schema.Types.ObjectId, required: true, immutable: true }, expenseRevision: { type: Number, required: true, immutable: true }, fundingKey: { type: String, required: true, immutable: true },
  quantity: { type: Number, required: true, min: 1, immutable: true }, amount: { type: Number, required: true, min: 0, immutable: true }, currency: { type: String, required: true, immutable: true },
  accountingAt: { type: Date, required: true, immutable: true }, operationId: { type: Schema.Types.ObjectId, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ key: 1 }, { unique: true }); schema.index({ orderId: 1, lineId: 1 }); schema.index({ expenseId: 1 });
export const InventoryCostSource = (models.InventoryCostSource || model("InventoryCostSource", schema)) as Model<InferSchemaType<typeof schema>>;
