import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/** Line caps are independent: one SKU cannot reverse another SKU's cost. */
const saleSchema = new Schema({
  key: { type: String, required: true, immutable: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  orderId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  subOrderId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  lineId: { type: String, required: true, immutable: true },
  cycle: { type: Number, default: 0, immutable: true },
  productId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  variantId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  positionKey: { type: String, required: true, immutable: true },
  currency: { type: String, required: true, uppercase: true, immutable: true },
  quantity: { type: Number, required: true, min: 0, immutable: true },
  allocatedQuantity: { type: Number, min: 0, default: 0 },
  costedQuantity: { type: Number, min: 0, default: 0 },
  restoredQuantity: { type: Number, min: 0, default: 0 },
  unitCost: { type: Number, min: 0, default: null, immutable: true },
  carryingValueRemoved: { type: Number, min: 0, default: 0 },
  costOfGoods: { type: Number, min: 0, default: 0 },
  saleMovementIds: { type: [Schema.Types.ObjectId], default: [] },
  segments: { type: [new Schema({
    movementId: { type: Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 0 },
    carryingValue: { type: Number, required: true, min: 0 },
    costOfGoods: { type: Number, required: true, min: 0 },
    restoredQuantity: { type: Number, default: 0, min: 0 },
  }, { _id: false })], default: [] },
  issue: { type: String, default: null },
  version: { type: Number, min: 0, default: 0 },
  generation: { type: Number, required: true, default: 1, immutable: true },
}, { timestamps: true });
saleSchema.index({ key: 1 }, { unique: true });
saleSchema.index({ orderId: 1, subOrderId: 1, lineId: 1, positionKey: 1, cycle: 1 }, { unique: true });
saleSchema.index({ ownerId: 1, currency: 1 });
saleSchema.pre("validate", function () {
  const counts = [this.quantity, this.allocatedQuantity, this.costedQuantity, this.restoredQuantity];
  if (counts.some((q) => !Number.isSafeInteger(q) || q < 0) || this.costedQuantity > this.allocatedQuantity || this.allocatedQuantity > this.quantity || this.restoredQuantity > this.costedQuantity) this.invalidate("quantity", "Sale allocation quantity caps disagree.");
  for (const segment of this.segments) if (!Number.isSafeInteger(segment.quantity) || !Number.isSafeInteger(segment.restoredQuantity) || segment.restoredQuantity > segment.quantity) this.invalidate("segments", "Original segment restock cap exceeded.");
});

const fundingSchema = new Schema({
  key: { type: String, required: true, immutable: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  expenseId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  expenseRevision: { type: Number, required: true, min: 0, immutable: true },
  movementId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  currency: { type: String, required: true, uppercase: true, immutable: true },
  amount: { type: Number, required: true, immutable: true },
  reversesAllocationId: { type: Schema.Types.ObjectId, immutable: true },
  fundingKey: { type: String, required: true, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
fundingSchema.index({ key: 1 }, { unique: true });
fundingSchema.index({ expenseId: 1, expenseRevision: 1 });
fundingSchema.index({ ownerId: 1, currency: 1 });
fundingSchema.index({ reversesAllocationId: 1 }, { unique: true, sparse: true });
fundingSchema.pre("validate", function () { if (!Number.isFinite(this.amount) || (this.amount < 0 && !this.reversesAllocationId)) this.invalidate("amount", "A negative funding allocation must reverse original evidence."); });

export type InventorySaleAllocationRecord = InferSchemaType<typeof saleSchema>;
export const InventorySaleAllocation = (models.InventorySaleAllocation || model("InventorySaleAllocation", saleSchema)) as Model<InventorySaleAllocationRecord>;
export type InventoryFundingAllocationRecord = InferSchemaType<typeof fundingSchema>;
export const InventoryFundingAllocation = (models.InventoryFundingAllocation || model("InventoryFundingAllocation", fundingSchema)) as Model<InventoryFundingAllocationRecord>;
