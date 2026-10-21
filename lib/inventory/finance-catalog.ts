import "server-only";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { financeQuery, financeSession } from "@/lib/finance/transaction";
import { InventoryPosition } from "@/models/inventory-position.model";
import { InventoryReservation } from "@/models/inventory-reservation.model";
import { inventoryCost, inventoryLineValue, inventoryProportionalAmount, inventoryRevaluationPostings, inventoryValuePostings, openingInventoryPostings } from "./finance-rules";
import { runInventoryMutation, type InventoryScope } from "./finance-service";
import { inventoryWriteContext } from "./finance-context";
import { inventoryPositionKey } from "./finance-position";
import { LEDGER_ACCOUNT } from "@/lib/finance/accounts";

export interface FinancialProduct {
  _id: unknown; vendorId?: unknown; name?: string; title?: string; sku?: string;
  cost?: number | null; stock?: number; inventoryFinanceGeneration?: number;
  inventoryFinanceCurrency?: string; inventory?: { tracked?: boolean };
  shipping?: { isPhysicalProduct?: boolean };
  locationInventory?: Array<{ locationId: unknown; quantity: number }>;
  variants?: Array<{ _id?: unknown; name?: string; sku?: string; cost?: number | null; stock?: number; locationInventory?: Array<{ locationId: unknown; quantity: number }> }>;
}
export function financialStockRows(product: FinancialProduct) {
  const rows = product.variants?.length ? product.variants : [product];
  return rows.flatMap((sku) => {
    const variantId = sku === product ? null : String(sku._id);
    const unitCost = inventoryCost(sku.cost) ?? inventoryCost(product.cost);
    const locations = sku.locationInventory?.length ? sku.locationInventory : [{ locationId: null, quantity: sku.stock ?? 0 }];
    return locations.map((location) => ({
      variantId, locationId: location.locationId ? String(location.locationId) : null,
      quantity: location.quantity, unitCost, sku: sku.sku ?? product.sku ?? "",
      variantName: sku === product ? null : sku.name ?? null,
    }));
  });
}
export function physicalFinancialProduct(product: FinancialProduct) {
  return product.inventory?.tracked !== false && product.shipping?.isPhysicalProduct !== false;
}

/** Called inside the physical write's transaction, including all derived model updates. */
export async function captureFinancialProduct(before: FinancialProduct | null, after: FinancialProduct | null): Promise<string[]> {
  const product = after ?? before;
  if (!product || product.inventoryFinanceGeneration !== 1 || inventoryWriteContext()?.skipCapture) return [];
  if (!after || !physicalFinancialProduct(after) || String(before?.vendorId ?? after.vendorId) !== String(after.vendorId)) throw new ApiError("Resolve owned inventory before deleting this product, changing its owner or disabling tracking.", 409, "OWNED_INVENTORY_CHANGE_REQUIRED");
  const ctx = inventoryWriteContext();
  const beforeRows = before ? financialStockRows(before) : [];
  const afterRows = financialStockRows(after);
  const key = (row: typeof afterRows[number]) => `${row.variantId}:${row.locationId}`;
  const oldRows = new Map(beforeRows.map((row) => [key(row), row]));
  const newRows = new Map(afterRows.map((row) => [key(row), row]));
  const operations: string[] = [];
  // Removing an empty shelf must not orphan reserved, held or transit assets.
  for (const [rowKey, old] of oldRows) if (!newRows.has(rowKey)) {
    const owned = await financeQuery(InventoryPosition.findOne({ key: inventoryPositionKey({ ownerId: String(after.vendorId), productId: String(after._id), variantId: old.variantId, locationId: old.locationId, currency: after.inventoryFinanceCurrency! }) }));
    if (owned?.quantity) throw new ApiError("Resolve owned units before removing this SKU or location.", 409, "OWNED_INVENTORY_CHANGE_REQUIRED");
  }
  const id = ctx?.sourceId ?? randomUUID();
  for (const rowKey of new Set([...oldRows.keys(), ...newRows.keys()])) {
    const old = oldRows.get(rowKey);
    const next = newRows.get(rowKey);
    const row = next ?? old!;
    const delta = (next?.quantity ?? 0) - (old?.quantity ?? 0);
    const costChanged = old != null && next != null && old.unitCost !== next.unitCost;
    if (!delta && !costChanged && before && old) continue;
    if (![old?.quantity ?? 0, next?.quantity ?? 0].every(Number.isSafeInteger)) throw new ApiError("Use whole inventory quantities.", 400, "INVALID_QUANTITY");
    const scope: InventoryScope = { ownerId: String(after.vendorId), productId: String(after._id), variantId: row.variantId, locationId: row.locationId, currency: after.inventoryFinanceCurrency! };
    let position = await financeQuery(InventoryPosition.findOne({ key: inventoryPositionKey(scope) }));
    if (before && !position && (old?.quantity ?? 0) !== 0) throw new ApiError("This stock needs a reconciled financial baseline.", 409, "INVENTORY_MIGRATION_REQUIRED");
    const common = {
      scope, actorId: ctx?.actorId ?? "system", occurredAt: new Date(), productName: after.name ?? after.title ?? "Product",
      generatedDate: true,
      variantName: row.variantName, sku: row.sku, channel: ctx?.channel ?? "system" as const,
      source: { kind: ctx?.sourceKind ?? "product", id, reference: ctx?.sourceId }, note: ctx?.note,
    };
    if (costChanged && position) {
      if (position.quantity && ctx?.valuationExpectedVersions && ctx.valuationExpectedVersions[position.key] !== position.version) throw new ApiError("Stock changed; refresh its valuation preview.", 409, "STALE_INVENTORY_VERSION");
      if (position.quantity && !ctx?.costChangeConfirmed) throw new ApiError("Preview and confirm the inventory valuation before changing cost.", 409, "INVENTORY_VALUATION_CONFIRMATION_REQUIRED");
      if (next!.unitCost === null || (position.missingCostQuantity && (ctx?.costEstablishment !== "opening" || position.missingCostQuantity !== position.quantity))) throw new ApiError("Classify missing-cost inventory through an opening or receipt correction before revaluation.", 409, "COST_CLASSIFICATION_REQUIRED");
      const establishOpening = position.missingCostQuantity > 0;
      const op = await runInventoryMutation({
        ...common, reason: establishOpening ? "opening" : "cost_revaluation", expectedVersion: position.version,
        requestKey: `${ctx?.requestKey ?? id}:revalue:${rowKey}`, fingerprint: { oldCost: old!.unitCost, newCost: next!.unitCost },
        plan: (p, event) => { const value = inventoryRevaluationPostings(event, p.quantity, p.carryingValue, next!.unitCost); return { change: { quantityDelta: 0, valueDelta: value.carryingValue - p.carryingValue, newUnitCost: next!.unitCost!, missingCostQuantity: 0 }, postings: establishOpening ? inventoryValuePostings(event, value.carryingValue, LEDGER_ACCOUNT.OPENING_INVENTORY_EQUITY, "opening-cost") : value.postings }; },
      });
      operations.push(op.operationId);
      position = await financeQuery(InventoryPosition.findOne({ key: inventoryPositionKey(scope) }));
    }
    if (!delta && before && old) continue;
    const reason = !before ? "opening" : !delta && !old ? "correction" : ctx?.reason ?? "correction";
    if (reason === "received") throw new ApiError("Use Add stock to record receipt funding.", 409, "RECEIPT_FUNDING_REQUIRED");
    const reservationKey = `${ctx?.sourceKind ?? "stock"}:${id}:${inventoryPositionKey(scope)}`;
    const reserve = reason === "reserve" && delta < 0;
    const release = reason === "release" && delta > 0;
    const reserveQuantity = reserve ? Math.min(-delta, position?.availableOwned ?? 0) : 0;
    const releaseReservations = release ? await financeQuery(InventoryReservation.find({ sourceKind: ctx?.sourceKind ?? "stock", sourceId: id, positionKey: inventoryPositionKey(scope) })).sort({ _id: 1 }) : [];
    const releaseQuantity = release ? Math.min(delta, releaseReservations.reduce((sum, r) => sum + r.quantity - r.claimedQuantity - r.releasedQuantity, 0)) : 0;
    const financialDelta = Math.max(0, next?.quantity ?? 0) - Math.max(0, old?.quantity ?? 0);
    if (reason === "return_restock") {
      const { captureFinancialRestock } = await import("./finance-sales");
      operations.push(...await captureFinancialRestock(scope, delta, common, ctx!.restock!, ctx!.requestKey ?? id));
      continue;
    }
    if (reason === "transfer") {
      const { captureFinancialTransfer } = await import("./finance-transfers");
      operations.push(...await captureFinancialTransfer(scope, delta, common, ctx!.transfer!, ctx!.requestKey ?? id));
      continue;
    }
    const op = await runInventoryMutation({
      ...common, reason, allowInitialize: !position && (!before || (old?.quantity ?? 0) === 0),
      physicalQuantityDelta: delta,
      expectedVersion: position?.version ?? 0, requestKey: `${ctx?.requestKey ?? id}:${reason}:${rowKey}:${position?.version ?? 0}`,
      fingerprint: { delta, cost: row.unitCost, physicalBefore: old?.quantity ?? 0 },
      plan: (p, event) => {
        if (reserve || release) return {
          change: { quantityDelta: 0, valueDelta: 0, stateDeltas: { availableOwned: reserve ? -reserveQuantity : releaseQuantity, reservedUncosted: reserve ? reserveQuantity : -releaseQuantity } }, postings: [],
        };
        const value = financialDelta < 0
          ? inventoryProportionalAmount({ totalAmount: p.carryingValue, totalQuantity: p.quantity, alreadyAllocated: 0, quantity: -financialDelta, currency: scope.currency })
          : row.unitCost === null ? 0 : inventoryLineValue(financialDelta, row.unitCost, scope.currency);
        const signed = Math.sign(financialDelta) * value;
        return {
          change: { quantityDelta: financialDelta, valueDelta: signed, ...(row.unitCost !== null && p.unitCost !== row.unitCost ? { newUnitCost: row.unitCost } : {}), missingCostQuantity: row.unitCost === null ? p.quantity + financialDelta : 0 },
          postings: reason === "opening" && row.unitCost !== null ? openingInventoryPostings(event, financialDelta, row.unitCost) : inventoryValuePostings(event, signed),
        };
      },
      afterMovement: async (movementId) => {
        if (reserve) await InventoryReservation.create([{
          key: `${reservationKey}:${movementId}`, sourceKind: ctx?.sourceKind ?? "stock", sourceId: id,
          productId: scope.productId, variantId: scope.variantId, positionKey: inventoryPositionKey(scope), quantity: reserveQuantity, requestedQuantity: -delta,
        }], { session: financeSession() });
        if (release) {
          let left = releaseQuantity;
          for (const reservation of releaseReservations) {
            const take = Math.min(left, reservation.quantity - reservation.claimedQuantity - reservation.releasedQuantity);
            reservation.releasedQuantity += take; left -= take;
            await reservation.save({ session: financeSession() });
          }
          if (left) throw new ApiError("Stock release exceeds its original reservation.", 409, "RESERVATION_CAP_EXCEEDED");
          let unbacked = delta - releaseQuantity;
          for (const reservation of releaseReservations) {
            const take = Math.min(unbacked, reservation.requestedQuantity - reservation.quantity - reservation.cancelledUnbackedQuantity);
            reservation.cancelledUnbackedQuantity += take; unbacked -= take;
            await reservation.save({ session: financeSession() });
          }
        }
      },
    });
    operations.push(op.operationId);
  }
  return operations;
}
