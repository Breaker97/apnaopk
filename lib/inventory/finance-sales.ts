import "server-only";
import { Types } from "mongoose";
import { Order } from "@/models/order.model";
import { InventoryPosition } from "@/models/inventory-position.model";
import { InventoryReservation } from "@/models/inventory-reservation.model";
import { InventorySaleAllocation } from "@/models/inventory-allocation.model";
import { InventoryMovement } from "@/models/inventory-movement.model";
import { financeQuery, financeSession, financeTransaction } from "@/lib/finance/transaction";
import { finishFinanceOperation } from "@/lib/finance/operations";
import { isConsignmentCollectedForStock, type PostingOrder } from "@/lib/finance/postings";
import { ApiError } from "@/lib/api/errors";
import { inventoryCost, inventoryLineValue, inventoryProportionalAmount, inventoryRestockPostings, inventorySalePostings, inventoryValuePostings } from "./finance-rules";
import { LEDGER_ACCOUNT } from "@/lib/finance/accounts";
import { runInventoryMutation, type InventoryScope, type InventoryMutation } from "./finance-service";
import { inventoryPositionKey } from "./finance-position";

type SaleOrder = PostingOrder & {
  checkoutAttemptId?: unknown; inventoryReservationSourceId?: string;
  subOrders?: Array<NonNullable<PostingOrder["subOrders"]>[number] & {
    inventoryFinanceCycle?: number;
    items?: Array<{ name?: string; sku?: string; productId?: unknown; variantId?: unknown; cost?: number | null; quantity?: number | null; inventoryFinanceGeneration?: number; inventoryLineId?: string }>;
  }>;
};
function reservationSources(order: SaleOrder) {
  return [
    { sourceKind: "order", sourceId: String(order._id) },
    ...(order.checkoutAttemptId ? [{ sourceKind: "checkout_attempt", sourceId: String(order.checkoutAttemptId) }] : []),
    ...(order.inventoryReservationSourceId ? [{ sourceKind: "order_reservation", sourceId: order.inventoryReservationSourceId }] : []),
  ];
}

/** Paid order is the durable recovery source when stock arrives after collection. */
export async function synchronizeOrderInventoryCost(orderId: unknown, completionCollector?: string[]) {
  const operationIds = await financeTransaction("Recognize allocated inventory cost", async () => {
    const order = await financeQuery(Order.findById(orderId)).lean<SaleOrder | null>();
    if (!order) return [];
    if (!(order.subOrders ?? []).some((sub) => (sub.items ?? []).some((item) => item.inventoryFinanceGeneration === 1))) return [];
    // Serialize all line/location claims for one order, including partial restocks.
    await financeQuery(Order.updateOne({ _id: orderId }, { $inc: { inventoryFinanceVersion: 1 } }));
    const operations: string[] = [];
    for (const sub of order.subOrders ?? []) {
      if (!isConsignmentCollectedForStock(order, sub) || ["cancelled", "expired"].includes(String(sub.status))) continue;
      for (const [index, item] of (sub.items ?? []).entries()) {
        if (item.inventoryFinanceGeneration !== 1) continue;
        const lineId = item.inventoryLineId ?? `${sub._id}:${index}`;
        const quantity = Number(item.quantity ?? 0);
        const cycle = sub.inventoryFinanceCycle ?? 0;
        const allocations = await financeQuery(InventorySaleAllocation.find({ orderId: String(orderId), subOrderId: String(sub._id), lineId, cycle }));
        let left = quantity - allocations.reduce((sum, a) => sum + a.allocatedQuantity, 0);
        if (left <= 0) continue;
        const reservations = await financeQuery(InventoryReservation.find({ productId: String(item.productId), variantId: item.variantId ? String(item.variantId) : null, $or: reservationSources(order) })).sort({ _id: 1 });
        for (const reservation of reservations) {
          const take = Math.min(left, reservation.quantity - reservation.claimedQuantity - reservation.releasedQuantity);
          if (!take) continue;
          const position = await financeQuery(InventoryPosition.findOne({ key: reservation.positionKey }));
          if (!position) throw new ApiError("Reservation's financial position is missing.", 409, "INVENTORY_POSITION_MISSING");
          const cost = inventoryCost(item.cost);
          if (cost === null || position.unitCost === null || position.missingCostQuantity || position.currency !== order.currency) continue;
          const scope: InventoryScope = { ownerId: String(position.ownerId), productId: String(position.productId), variantId: position.variantId ? String(position.variantId) : null, locationId: position.locationId ? String(position.locationId) : null, currency: position.currency };
          const allocated = allocations.find((a) => a.positionKey === position.key) ?? new InventorySaleAllocation({
            key: `${order._id}:${sub._id}:${lineId}:${position.key}:${cycle}`, orderId: order._id, subOrderId: sub._id, lineId, cycle,
            ...scope, positionKey: position.key, quantity, unitCost: cost,
          });
          const carried = inventoryProportionalAmount({ totalAmount: position.carryingValue, totalQuantity: position.quantity, alreadyAllocated: 0, quantity: take, currency: scope.currency });
          const cogs = inventoryLineValue(take, cost, scope.currency);
          const predecessor = position.lastMovementId ? await financeQuery(InventoryMovement.findById(position.lastMovementId)).select("accountingAt occurredAt").lean() : null;
          // Collection before allocation recognizes cost when stock actually arrives.
          // Keep projection snapshots chronological, including intervening revaluations.
          const eligibleAt = new Date(Math.max(new Date(sub.paidAt ?? order.paidAt ?? order.createdAt ?? Date.now()).getTime(), reservation.updatedAt.getTime(), predecessor?.accountingAt?.getTime() ?? 0));
          const op = await runInventoryMutation({
            scope, actorId: "system", channel: "system", productName: item.name ?? "Order stock", sku: item.sku, reason: "sale_costed", physicalQuantityDelta: 0, financialState: "sale_costed", expectedVersion: position.version,
            occurredAt: eligibleAt,
            requestKey: `sale:${order._id}:${lineId}:${reservation._id}:${reservation.claimedQuantity}`,
            fingerprint: { take, cost, positionVersion: position.version }, source: { kind: "order", id: String(order._id), lineId, reference: order.orderNumber ?? undefined },
            plan: (_, event) => ({ change: { quantityDelta: -take, valueDelta: -carried, state: "reservedUncosted" }, postings: inventorySalePostings(event, carried, cogs) }),
            afterMovement: async (movementId) => {
              reservation.claimedQuantity += take;
              await reservation.save({ session: financeSession() });
              allocated.allocatedQuantity += take; allocated.costedQuantity += take;
              allocated.carryingValueRemoved += carried; allocated.costOfGoods += cogs; allocated.version++;
              allocated.saleMovementIds.push(new Types.ObjectId(movementId));
              allocated.segments.push({ movementId: new Types.ObjectId(movementId), quantity: take, carryingValue: carried, costOfGoods: cogs, restoredQuantity: 0 });
              await allocated.save({ session: financeSession() });
            },
          });
          operations.push(op.operationId); left -= take;
          if (!allocations.includes(allocated)) allocations.push(allocated);
        }
      }
    }
    return operations;
  });
  if (!financeSession()) for (const id of operationIds) await finishFinanceOperation(id);
  completionCollector?.push(...operationIds);
  return operationIds.length;
}

/** Arrivals satisfy an oversold reservation before becoming sellable a second time. */
export async function allocateUnbackedInventory(scope: InventoryScope, receiptId: string, quantity: number) {
  const reservations = await financeQuery(InventoryReservation.find({ positionKey: inventoryPositionKey(scope), $expr: { $gt: ["$requestedQuantity", { $add: ["$quantity", "$cancelledUnbackedQuantity"] }] } })).sort({ _id: 1 });
  const operations: string[] = [];
  let remaining = quantity;
  for (const reservation of reservations) {
    const take = Math.min(remaining, reservation.requestedQuantity - reservation.quantity - reservation.cancelledUnbackedQuantity);
    if (!take) continue;
    const position = await financeQuery(InventoryPosition.findOne({ key: reservation.positionKey }));
    if (!position) throw new ApiError("Receipt financial position is missing.", 409, "INVENTORY_POSITION_MISSING");
    const op = await runInventoryMutation({
      scope, actorId: "system", channel: "system", productName: "Received reservation stock", reason: "reserve", occurredAt: new Date(), generatedDate: true,
      requestKey: `receipt-allocation:${receiptId}:${reservation._id}`, fingerprint: { quantity: take }, expectedVersion: position.version,
      source: { kind: reservation.sourceKind, id: reservation.sourceId, reference: receiptId },
      plan: () => ({ change: { quantityDelta: 0, valueDelta: 0, stateDeltas: { availableOwned: -take, reservedUncosted: take } }, postings: [] }),
      afterMovement: async () => { reservation.quantity += take; await reservation.save({ session: financeSession() }); },
    });
    operations.push(op.operationId); remaining -= take;
    const order = await financeQuery(Order.findOne(reservation.sourceKind === "order" ? { _id: reservation.sourceId } : reservation.sourceKind === "checkout_attempt" ? { checkoutAttemptId: reservation.sourceId } : { inventoryReservationSourceId: reservation.sourceId })).select("_id").lean();
    if (order) await synchronizeOrderInventoryCost(order._id, operations);
  }
  return operations;
}

/** Physical restock and these original, per-segment reversals commit together. */
export async function captureFinancialRestock(
  scope: InventoryScope, quantity: number,
  common: Pick<InventoryMutation, "actorId" | "occurredAt" | "productName" | "variantName" | "sku" | "channel" | "source" | "note">,
  source: { orderId: string; subOrderId?: string; lineId?: string }, eventKey: string,
): Promise<string[]> {
  if (!source?.orderId || quantity <= 0) throw new ApiError("Restock must reference its original sale.", 409, "RESTOCK_SOURCE_REQUIRED");
  await financeQuery(Order.updateOne({ _id: source.orderId }, { $inc: { inventoryFinanceVersion: 1 } }));
  const order = await financeQuery(Order.findById(source.orderId)).lean<SaleOrder | null>();
  if (!order) throw new ApiError("Original order is missing.", 409, "RESTOCK_SOURCE_REQUIRED");
  const allocations = await financeQuery(InventorySaleAllocation.find({ orderId: source.orderId, productId: scope.productId, variantId: scope.variantId ?? null,
    ...(source.subOrderId ? { subOrderId: source.subOrderId } : {}), ...(source.lineId ? { lineId: source.lineId } : {}),
  })).sort({ _id: 1 });
  if (!source.lineId && new Set(allocations.filter((a) => a.costedQuantity > a.restoredQuantity).map((a) => a.lineId)).size > 1) throw new ApiError("Choose the original order line for this partial restock.", 409, "RESTOCK_LINE_REQUIRED");
  let remaining = quantity;
  const operations: string[] = [];
  for (const allocation of allocations) {
    if (allocation.currency !== scope.currency) throw new ApiError("Persist the original valuation currency conversion before restocking.", 409, "INVENTORY_FX_REQUIRED");
    for (const [index, segment] of allocation.segments.entries()) {
      const take = Math.min(remaining, segment.quantity - segment.restoredQuantity);
      if (!take) continue;
      const position = await financeQuery(InventoryPosition.findOne({ key: inventoryPositionKey(scope) }));
      const basis = await financeQuery(InventoryPosition.findOne({ key: allocation.positionKey }));
      const cost = position?.unitCost ?? basis?.unitCost;
      const op = await runInventoryMutation({
        ...common, scope, source: { ...common.source, lineId: allocation.lineId }, physicalQuantityDelta: remaining === quantity ? quantity : 0, financialState: "owned_available", reason: "return_restock", expectedVersion: position?.version ?? 0, allowInitialize: !position,
        requestKey: `${eventKey}:${allocation._id}:${index}`, fingerprint: { take, previouslyRestored: segment.restoredQuantity, version: position?.version ?? 0 },
        plan: (_, event) => {
          const reversal = inventoryRestockPostings(event, { originalQuantity: segment.quantity, originalCarryingValue: segment.carryingValue, originalCostOfGoods: segment.costOfGoods, alreadyRestocked: segment.restoredQuantity, quantity: take, currentUnitCost: cost });
          return { change: { quantityDelta: take, valueDelta: reversal.carryingValue, newUnitCost: cost! }, postings: reversal.postings };
        },
        afterMovement: async () => { segment.restoredQuantity += take; allocation.restoredQuantity += take; allocation.version++; await allocation.save({ session: financeSession() }); },
      });
      operations.push(op.operationId); remaining -= take;
    }
  }
  if (remaining) {
    // Unpaid or missing-cost reservation: release owned stock, never reverse invented COGS.
    const reservations = await financeQuery(InventoryReservation.find({ productId: scope.productId, variantId: scope.variantId ?? null, $or: reservationSources(order) })).sort({ _id: 1 });
    for (const reservation of reservations) {
      const take = Math.min(remaining, reservation.quantity - reservation.claimedQuantity - reservation.releasedQuantity);
      if (!take) continue;
      if (reservation.positionKey !== inventoryPositionKey(scope)) throw new ApiError("Release this unpaid reservation to its original location.", 409, "RESERVATION_LOCATION_MISMATCH");
      const position = await financeQuery(InventoryPosition.findOne({ key: reservation.positionKey }));
      if (!position) throw new ApiError("Original reservation position is missing.", 409, "INVENTORY_POSITION_MISSING");
      const op = await runInventoryMutation({
        ...common, scope, physicalQuantityDelta: remaining === quantity ? quantity : 0, financialState: "owned_available", reason: "release", expectedVersion: position.version, requestKey: `${eventKey}:release:${reservation._id}`,
        fingerprint: { take, previouslyReleased: reservation.releasedQuantity },
        plan: () => ({ change: { quantityDelta: 0, valueDelta: 0, stateDeltas: { availableOwned: take, reservedUncosted: -take } }, postings: [] }),
        afterMovement: async () => { reservation.releasedQuantity += take; await reservation.save({ session: financeSession() }); },
      });
      operations.push(op.operationId); remaining -= take;
    }
    for (const reservation of reservations) {
      const take = Math.min(remaining, reservation.requestedQuantity - reservation.quantity - reservation.cancelledUnbackedQuantity);
      if (!take) continue;
      const position = await financeQuery(InventoryPosition.findOne({ key: reservation.positionKey }));
      if (!position) throw new ApiError("Original reservation position is missing.", 409, "INVENTORY_POSITION_MISSING");
      const op = await runInventoryMutation({
        ...common, scope, physicalQuantityDelta: remaining === quantity ? quantity : 0, financialState: "owned_available", reason: "release", generatedDate: true, expectedVersion: position.version, requestKey: `${eventKey}:unbacked:${reservation._id}`, fingerprint: { take },
        plan: () => ({ change: { quantityDelta: 0, valueDelta: 0 }, postings: [] }),
        afterMovement: async () => { reservation.cancelledUnbackedQuantity += take; await reservation.save({ session: financeSession() }); },
      });
      operations.push(op.operationId); remaining -= take;
    }
  }
  if (remaining) {
    // A sale made before the inventory cutover that recorded no cost: nothing
    // left the ledger for it, and the cutover's opening snapshot left these
    // units out as sold. Back on the shelf they re-enter at today's fixed cost
    // against opening equity — the balance they were always missing — never as
    // a gain in Net. Capped at what the legacy lines sold, less earlier
    // fallback restocks of the same order.
    const legacyLines = (order.subOrders ?? []).filter((sub) => String(sub.vendorId) === scope.ownerId)
      .flatMap((sub) => sub.items ?? [])
      .filter((item) => !item.inventoryFinanceGeneration && String(item.productId) === scope.productId && (item.variantId ? String(item.variantId) : null) === (scope.variantId ?? null));
    // Lines the cutover adopted restock through their allocation above, never here.
    const adopted = allocations.filter((a) => a.generation === 0).reduce((sum, a) => sum + a.quantity, 0);
    const sold = legacyLines.reduce((sum, item) => sum + Math.max(0, Number(item.quantity ?? 0)), 0) - adopted;
    const earlier = await financeQuery(InventoryMovement.find({ "source.kind": "legacy_restock", "source.id": String(order._id), productId: scope.productId, variantId: scope.variantId ?? null }).select("quantityDelta")).lean();
    const take = Math.min(remaining, sold - earlier.reduce((sum, m) => sum + m.quantityDelta, 0));
    if (take > 0) {
      const position = await financeQuery(InventoryPosition.findOne({ key: inventoryPositionKey(scope) }));
      const cost = position?.unitCost ?? null;
      const value = cost === null ? 0 : inventoryLineValue(take, cost, scope.currency);
      const op = await runInventoryMutation({
        ...common, scope, source: { kind: "legacy_restock", id: String(order._id), reference: order.orderNumber ?? undefined },
        physicalQuantityDelta: remaining === quantity ? quantity : 0, financialState: "owned_available", reason: "historical_reconciliation",
        expectedVersion: position?.version ?? 0, allowInitialize: !position,
        // One per position and per earlier fallback: a cancellation restores
        // every product of the order in one event, sometimes one SKU twice.
        requestKey: `${eventKey}:legacy:${String(order._id)}:${inventoryPositionKey(scope)}:${earlier.length}`, fingerprint: { take, earlier: earlier.length, version: position?.version ?? 0 },
        plan: (p, event) => ({
          change: { quantityDelta: take, valueDelta: value, ...(cost === null ? { missingCostQuantity: p.quantity + take } : {}) },
          postings: inventoryValuePostings(event, value, LEDGER_ACCOUNT.OPENING_INVENTORY_EQUITY, "legacy-restock"),
        }),
      });
      operations.push(op.operationId); remaining -= take;
    }
  }
  if (remaining) throw new ApiError("Restock exceeds this line's original allocated quantity remaining.", 409, "RESTOCK_CAP_EXCEEDED");
  return operations;
}
