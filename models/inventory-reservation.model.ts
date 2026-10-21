import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
const schema = new Schema({
  key: { type: String, required: true, immutable: true },
  sourceKind: { type: String, required: true, immutable: true },
  sourceId: { type: String, required: true, immutable: true },
  productId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  variantId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  positionKey: { type: String, required: true, immutable: true },
  quantity: { type: Number, required: true, min: 0 },
  requestedQuantity: { type: Number, required: true, min: 0 },
  claimedQuantity: { type: Number, default: 0, min: 0 },
  releasedQuantity: { type: Number, default: 0, min: 0 },
  cancelledUnbackedQuantity: { type: Number, default: 0, min: 0 },
}, { timestamps: true });
schema.index({ key: 1 }, { unique: true });
schema.index({ sourceKind: 1, sourceId: 1, productId: 1, variantId: 1 });
schema.pre("validate", function () {
  if (![this.quantity, this.requestedQuantity, this.claimedQuantity, this.releasedQuantity, this.cancelledUnbackedQuantity].every(Number.isSafeInteger) || this.quantity + this.cancelledUnbackedQuantity > this.requestedQuantity || this.claimedQuantity + this.releasedQuantity > this.quantity) this.invalidate("quantity", "Reservation claim exceeds original quantity.");
});
export type InventoryReservationRecord = InferSchemaType<typeof schema>;
export const InventoryReservation = (models.InventoryReservation || model("InventoryReservation", schema)) as Model<InventoryReservationRecord>;
