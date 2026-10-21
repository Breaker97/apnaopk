import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/** Rebuildable projection of financially owned units, not raw Available stock. */
const schema = new Schema({
  key: { type: String, required: true, immutable: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  productId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  variantId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  locationId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  currency: { type: String, uppercase: true, required: true, immutable: true },
  quantity: { type: Number, min: 0, required: true },
  carryingValue: { type: Number, min: 0, required: true },
  unitCost: { type: Number, min: 0, default: null },
  missingCostQuantity: { type: Number, min: 0, default: 0 },
  deferredCostQuantity: { type: Number, min: 0, default: 0 },
  availableOwned: { type: Number, min: 0, default: 0 },
  reservedUncosted: { type: Number, min: 0, default: 0 },
  unavailableOwned: { type: Number, min: 0, default: 0 },
  inTransitOwned: { type: Number, min: 0, default: 0 },
  costVersion: { type: Number, min: 0, default: 0 },
  version: { type: Number, min: 0, default: 0 },
  generation: { type: Number, required: true, default: 1 },
  lastMovementId: { type: Schema.Types.ObjectId, default: null },
}, { timestamps: true });
schema.pre("validate", function () {
  const states = [this.availableOwned, this.reservedUncosted, this.unavailableOwned, this.inTransitOwned];
  for (const field of ["quantity", "missingCostQuantity", "deferredCostQuantity", "version", "costVersion"] as const) {
    if (!Number.isSafeInteger(this[field]) || this[field] < 0) this.invalidate(field, "Use non-negative whole numbers.");
  }
  if (states.some((value) => !Number.isSafeInteger(value) || value < 0) || states.reduce((sum, value) => sum + value, 0) !== this.quantity) this.invalidate("quantity", "Owned financial states must sum to quantity.");
  if (this.quantity === 0 && this.carryingValue !== 0) this.invalidate("carryingValue", "No units may retain stranded value.");
  if (this.missingCostQuantity > this.quantity) this.invalidate("missingCostQuantity", "Missing-cost units exceed the owned quantity.");
  if (!Number.isFinite(this.carryingValue) || (this.carryingValue > 0 && this.unitCost == null)) this.invalidate("carryingValue", "Valued stock needs a recorded unit cost.");
});
schema.index({ key: 1 }, { unique: true });
schema.index({ ownerId: 1, currency: 1, productId: 1, variantId: 1, locationId: 1 }, { unique: true });
schema.index({ ownerId: 1, currency: 1 });

export type InventoryPositionRecord = InferSchemaType<typeof schema>;
export const InventoryPosition = (models.InventoryPosition || model("InventoryPosition", schema)) as Model<InventoryPositionRecord>;
