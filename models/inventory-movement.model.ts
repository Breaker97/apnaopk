import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { INVENTORY_REASONS } from "@/lib/inventory/finance-rules";

/** Immutable quantity/value evidence. Posting completion lives in FinanceOperation. */
const schema = new Schema({
  key: { type: String, required: true, immutable: true },
  fingerprint: { type: String, required: true, immutable: true },
  ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  productId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  variantId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  locationId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  positionKey: { type: String, required: true, immutable: true },
  productName: { type: String, required: true, immutable: true },
  variantName: { type: String, default: null, immutable: true },
  sku: { type: String, default: "", immutable: true },
  reason: { type: String, enum: INVENTORY_REASONS, required: true, immutable: true },
  currency: { type: String, uppercase: true, required: true, immutable: true },
  quantityBefore: { type: Number, required: true, min: 0, immutable: true },
  quantityDelta: { type: Number, required: true, immutable: true },
  physicalQuantityDelta: { type: Number, default: 0, immutable: true },
  physicalUnavailableDelta: { type: Number, default: 0, immutable: true },
  financialState: { type: String, enum: ["owned_available", "owned_reserved_uncosted", "owned_unavailable", "owned_in_transit", "sale_costed", "returned_unvalued", "written_off"], default: null, immutable: true },
  physicalAvailableAfter: { type: Number, default: null, immutable: true },
  quantityAfter: { type: Number, required: true, min: 0, immutable: true },
  valueBefore: { type: Number, required: true, min: 0, immutable: true },
  valueDelta: { type: Number, required: true, immutable: true },
  valueAfter: { type: Number, required: true, min: 0, immutable: true },
  unitCost: { type: Number, default: null, min: 0, immutable: true },
  costVersion: { type: Number, required: true, min: 0, immutable: true },
  statesAfter: { type: Schema.Types.Mixed, default: null, immutable: true },
  missingCostQuantityAfter: { type: Number, default: 0, immutable: true },
  occurredAt: { type: Date, required: true, immutable: true },
  accountingAt: { type: Date, required: true, immutable: true },
  actorId: { type: String, required: true, immutable: true },
  channel: { type: String, enum: ["web", "mobile", "system", "migration"], required: true, immutable: true },
  source: {
    type: new Schema({
      kind: { type: String, required: true },
      id: { type: String, required: true },
      lineId: { type: String, default: null },
      reference: { type: String, default: null },
    }, { _id: false }),
    required: true, immutable: true,
  },
  expenseId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  fundingAdopted: { type: Number, default: 0, immutable: true },
  paymentDisposition: { type: String, enum: ["paid", "unpaid", "already_recorded"], immutable: true },
  reversesMovementId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  note: { type: String, maxlength: 500, default: null, immutable: true },
  postings: { type: [Schema.Types.Mixed], required: true, default: [], immutable: true },
  generation: { type: Number, required: true, default: 1, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.pre("validate", function () {
  if (![this.quantityBefore, this.quantityDelta, this.quantityAfter].every(Number.isSafeInteger)) this.invalidate("quantityDelta", "Movement quantities must be whole numbers.");
  if (this.quantityBefore + this.quantityDelta !== this.quantityAfter) this.invalidate("quantityAfter", "Movement quantity snapshots disagree.");
  if (![this.valueBefore, this.valueDelta, this.valueAfter].every(Number.isFinite) || Math.abs(this.valueBefore + this.valueDelta - this.valueAfter) > 1e-8) this.invalidate("valueAfter", "Movement value snapshots disagree.");
});
schema.index({ key: 1 }, { unique: true });
schema.index({ ownerId: 1, currency: 1, accountingAt: 1, _id: 1 });
schema.index({ productId: 1, variantId: 1, occurredAt: -1, _id: -1 });
schema.index({ positionKey: 1, accountingAt: 1, _id: 1 });
schema.index({ "source.kind": 1, "source.id": 1, "source.lineId": 1 });

export type InventoryMovementRecord = InferSchemaType<typeof schema>;
export const InventoryMovement = (models.InventoryMovement || model("InventoryMovement", schema)) as Model<InventoryMovementRecord>;
