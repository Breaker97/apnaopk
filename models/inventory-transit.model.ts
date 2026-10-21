import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
const schema = new Schema({
  key: { type: String, required: true, immutable: true },
  transferId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  positionKey: { type: String, required: true, immutable: true },
  productId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  variantId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  quantity: { type: Number, min: 0, required: true, immutable: true },
  consumedQuantity: { type: Number, min: 0, default: 0 },
}, { timestamps: true });
schema.index({ key: 1 }, { unique: true });
schema.index({ transferId: 1, productId: 1, variantId: 1 });
schema.pre("validate", function () {
  if (!Number.isSafeInteger(this.quantity) || !Number.isSafeInteger(this.consumedQuantity) || this.consumedQuantity > this.quantity) this.invalidate("consumedQuantity", "Transit allocation cap exceeded.");
});
export type InventoryTransitRecord = InferSchemaType<typeof schema>;
export const InventoryTransit = (models.InventoryTransit || model("InventoryTransit", schema)) as Model<InventoryTransitRecord>;
