import "server-only";
import { InventoryPosition } from "@/models/inventory-position.model";
import { InventoryTransit } from "@/models/inventory-transit.model";
import { Product } from "@/models/product.model";
import { ApiError } from "@/lib/api/errors";
import { financeQuery, financeSession } from "@/lib/finance/transaction";
import { inventoryPositionKey } from "./finance-position";
import { inventoryProportionalAmount, inventoryValuePostings } from "./finance-rules";
import { runInventoryMutation, type InventoryScope, type InventoryMutation } from "./finance-service";

type Common = Pick<InventoryMutation, "actorId" | "occurredAt" | "productName" | "variantName" | "sku" | "channel" | "source" | "note">;
type TransferContext = { id: string; phase: "ship" | "receive" | "cancel"; from: string; to: string };
export async function captureFinancialTransfer(scope: InventoryScope, delta: number, common: Common, source: TransferContext, eventKey: string) {
  if (!source) throw new ApiError("Transfer attribution is required.", 409, "TRANSFER_CONTEXT_REQUIRED");
  const key = `${source.id}:${scope.productId}:${scope.variantId ?? "main"}`;
  const sourceScope = { ...scope, locationId: source.from };
  const sourcePosition = await financeQuery(InventoryPosition.findOne({ key: inventoryPositionKey(sourceScope) }));
  if (!sourcePosition) throw new ApiError("Transfer source inventory is not initialized.", 409, "INVENTORY_NOT_INITIALIZED");
  if (source.phase === "ship") {
    const quantity = -delta;
    if (quantity <= 0) return [];
    const op = await runInventoryMutation({
      ...common, scope: sourceScope, generatedDate: true, reason: "transfer", expectedVersion: sourcePosition.version, requestKey: `${eventKey}:ship:${key}`, fingerprint: { quantity }, physicalQuantityDelta: delta,
      plan: () => ({ change: { quantityDelta: 0, valueDelta: 0, stateDeltas: { availableOwned: -quantity, inTransitOwned: quantity } }, postings: [] }),
      afterMovement: async () => { await InventoryTransit.create([{ key, transferId: source.id, positionKey: sourcePosition.key, productId: scope.productId, variantId: scope.variantId, quantity }], { session: financeSession() }); },
    });
    return [op.operationId];
  }
  const transit = await financeQuery(InventoryTransit.findOne({ key }));
  if (!transit || delta <= 0 || delta > transit.quantity - transit.consumedQuantity) throw new ApiError("Transfer exceeds its owned transit allocation remaining.", 409, "TRANSIT_CAP_EXCEEDED");
  if (source.phase === "cancel") {
    const op = await runInventoryMutation({
      ...common, scope: sourceScope, generatedDate: true, reason: "transfer", expectedVersion: sourcePosition.version, requestKey: `${eventKey}:cancel:${key}`, fingerprint: { delta }, physicalQuantityDelta: delta,
      plan: () => ({ change: { quantityDelta: 0, valueDelta: 0, stateDeltas: { availableOwned: delta, inTransitOwned: -delta } }, postings: [] }),
      afterMovement: async () => { transit.consumedQuantity += delta; await transit.save({ session: financeSession() }); },
    });
    return [op.operationId];
  }
  const destination = await financeQuery(InventoryPosition.findOne({ key: inventoryPositionKey(scope) }));
  // A SKU with no cost yet moves at no value: its units stay "missing cost" at
  // both ends, and setting the cost later values every location at once. The
  // ship phase never asked for a cost, so refusing here stranded the units in
  // transit. Only a position that mixes costed and uncosted units is refused.
  const uncosted = sourcePosition.unitCost === null;
  if ((!uncosted && sourcePosition.missingCostQuantity) || (uncosted && destination?.unitCost != null)) throw new ApiError("Transfer stock has missing valuation cost.", 409, "COST_MISSING");
  const value = uncosted ? 0 : inventoryProportionalAmount({ totalAmount: sourcePosition.carryingValue, totalQuantity: sourcePosition.quantity, alreadyAllocated: 0, quantity: delta, currency: scope.currency });
  const out = await runInventoryMutation({
    ...common, scope: sourceScope, generatedDate: true, reason: "transfer", expectedVersion: sourcePosition.version, physicalQuantityDelta: 0, requestKey: `${eventKey}:out:${key}`, fingerprint: { delta, value },
    plan: (p, event) => ({ change: { quantityDelta: -delta, valueDelta: -value, state: "inTransitOwned", ...(uncosted ? { missingCostQuantity: Math.max(0, p.missingCostQuantity - delta) } : {}) }, postings: inventoryValuePostings(event, -value, undefined, "transfer-out") }),
    afterMovement: async () => { transit.consumedQuantity += delta; await transit.save({ session: financeSession() }); },
  });
  const incoming = await runInventoryMutation({
    ...common, scope, generatedDate: true, reason: "transfer", allowInitialize: !destination, expectedVersion: destination?.version ?? 0, requestKey: `${eventKey}:in:${key}`, fingerprint: { delta, value }, physicalQuantityDelta: delta,
    plan: (p, event) => ({ change: { quantityDelta: delta, valueDelta: value, ...(uncosted ? { missingCostQuantity: (p.missingCostQuantity ?? 0) + delta } : destination?.unitCost !== sourcePosition.unitCost ? { newUnitCost: sourcePosition.unitCost! } : {}) }, postings: inventoryValuePostings(event, value, undefined, "transfer-in") }),
  });
  return [out.operationId, incoming.operationId];
}

export async function rejectFinancialTransit(input: { transferId: string; fromLocationId: string; receiptId: string; actorId: string; lines: Array<{ productId: string; variantId: string; rejected: number }> }) {
  const operations: string[] = [];
  for (const line of input.lines) {
    if (!line.rejected) continue;
    const product = await financeQuery(Product.findById(line.productId)).lean();
    if (product?.inventoryFinanceGeneration !== 1) continue;
    const scope: InventoryScope = { ownerId: String(product.vendorId), productId: line.productId, variantId: line.variantId || null, locationId: input.fromLocationId, currency: product.inventoryFinanceCurrency! };
    const position = await financeQuery(InventoryPosition.findOne({ key: inventoryPositionKey(scope) }));
    const transit = await financeQuery(InventoryTransit.findOne({ key: `${input.transferId}:${line.productId}:${line.variantId || "main"}` }));
    if (!position || !transit || line.rejected > transit.quantity - transit.consumedQuantity) throw new ApiError("Rejected units exceed this transfer's remaining allocation.", 409, "TRANSIT_CAP_EXCEEDED");
    const value = inventoryProportionalAmount({ totalAmount: position.carryingValue, totalQuantity: position.quantity, alreadyAllocated: 0, quantity: line.rejected, currency: scope.currency });
    const op = await runInventoryMutation({
      scope, actorId: input.actorId, channel: "system", productName: product.name, reason: "damaged", expectedVersion: position.version, occurredAt: new Date(), generatedDate: true,
      physicalQuantityDelta: 0, financialState: "written_off", requestKey: `transfer-rejected:${input.receiptId}:${transit.key}`, fingerprint: line, source: { kind: "transfer", id: input.transferId, reference: input.receiptId },
      plan: (_, event) => ({ change: { quantityDelta: -line.rejected, valueDelta: -value, state: "inTransitOwned", missingCostQuantity: position.unitCost === null ? position.quantity - line.rejected : 0 }, postings: inventoryValuePostings(event, -value, undefined, "transfer-write-off") }),
      afterMovement: async () => { transit.consumedQuantity += line.rejected; await transit.save({ session: financeSession() }); },
    });
    operations.push(op.operationId);
  }
  return operations;
}
