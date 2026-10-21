import "server-only";
import { ApiError } from "@/lib/api/errors";
import { Types } from "mongoose";
import { InventoryPosition } from "@/models/inventory-position.model";
import { InventoryMovement } from "@/models/inventory-movement.model";
import { InventoryFundingAllocation, InventorySaleAllocation } from "@/models/inventory-allocation.model";
import { FinanceOperation } from "@/models/finance-operation.model";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { Product } from "@/models/product.model";
import { InventoryLocation } from "@/models/inventory-location.model";
import { Order } from "@/models/order.model";
import { getDefaultVendorIds } from "@/lib/finance/post-events";
import type { LedgerPosting } from "@/lib/finance/ledger";
import { financialStockRows } from "./finance-catalog";
import { inventoryLedgerEffect, inventoryMoney, inventoryReconciliation, type InventoryReason } from "./finance-rules";
import { quantizeToCurrency } from "@/lib/intl/money";
import { escapeRegExp } from "@/lib/strings";

export interface InventoryReportScope { currency: string; asOf: Date; productId?: string; variantId?: string; locationId?: string; productFilter?: Record<string, unknown>; locationIds?: readonly string[]; }
interface InventoryMongoScope {
  ownerId: { $in: Types.ObjectId[] }; currency: string;
  productId?: Types.ObjectId | { $in: Types.ObjectId[] };
  variantId?: Types.ObjectId;
  locationId?: Types.ObjectId | { $in: Types.ObjectId[] };
}
export async function inventoryMovementScope(input: InventoryReportScope): Promise<InventoryMongoScope> {
  const owners = [...await getDefaultVendorIds()].map((id) => new Types.ObjectId(id));
  const products = input.productFilter && Object.keys(input.productFilter).length ? await Product.distinct("_id", input.productFilter) : null;
  const permittedProduct = !input.productId || !products || products.some((id) => String(id) === input.productId);
  const permittedLocation = !input.locationId || !input.locationIds?.length || input.locationIds.includes(input.locationId);
  if (!permittedProduct || !permittedLocation) throw new ApiError("Inventory scope is outside your assigned products or locations.", 403, "INVENTORY_SCOPE_FORBIDDEN");
  return {
    ownerId: { $in: owners }, currency: input.currency,
    ...(input.productId ? { productId: permittedProduct ? new Types.ObjectId(input.productId) : { $in: [] } } : products ? { productId: { $in: products.map((id) => new Types.ObjectId(String(id))) } } : {}),
    ...(input.variantId ? { variantId: new Types.ObjectId(input.variantId) } : {}),
    ...(input.locationId ? { locationId: permittedLocation ? new Types.ObjectId(input.locationId) : { $in: [] } } : input.locationIds?.length ? { locationId: { $in: input.locationIds.map((id) => new Types.ObjectId(id)) } } : {}),
  };
}
export async function inventoryMovementHistory(input: InventoryReportScope & { before?: string; page?: number; search?: string; limit: number; reason?: InventoryReason; actorId?: string; state?: "owned_available" | "owned_reserved_uncosted" | "owned_unavailable" | "owned_in_transit" | "sale_costed" | "returned_unvalued" | "written_off"; from?: Date; payment?: "paid" | "unpaid" | "already_recorded" }) {
  const scope = await inventoryMovementScope(input);
  const filter = { ...scope, accountingAt: { $lte: input.asOf, ...(input.from ? { $gte: input.from } : {}) }, ...(input.actorId ? { actorId: input.actorId } : {}), ...(input.state ? { financialState: input.state } : {}), ...(input.payment ? { paymentDisposition: input.payment } : {}), ...(input.reason ? { reason: input.reason } : {}), ...(input.search?.trim() ? { $or: ["productName", "sku", "variantName", "source.reference"].map((field) => ({ [field]: { $regex: escapeRegExp(input.search!.trim()), $options: "i" } })) } : {}) };
  // A numbered page (the admin table) skips and counts; without one the cursor
  // keeps working for the mobile API and anything else that pages by `before`.
  const paged = input.page !== undefined;
  const [rows, total] = await Promise.all([
    paged
      ? InventoryMovement.find(filter).sort({ _id: -1 }).skip((input.page! - 1) * input.limit).limit(input.limit).lean()
      : InventoryMovement.find({ ...filter, ...(input.before ? { _id: { $lt: new Types.ObjectId(input.before) } } : {}) }).sort({ _id: -1 }).limit(input.limit + 1).lean(),
    paged ? InventoryMovement.countDocuments(filter) : Promise.resolve(undefined),
  ]);
  const page = rows.slice(0, input.limit);
  const [operations, products] = await Promise.all([
    FinanceOperation.find({ action: "inventory:movement", sourceId: { $in: page.map((r) => String(r._id)) } }).select("sourceId state").lean(),
    Product.find({ _id: { $in: [...new Set(page.map((r) => String(r.productId)))].map((id) => new Types.ObjectId(id)) } }).select("images").lean(),
  ]);
  return {
    items: page.map((r) => ({ ...r, bookkeepingState: operations.find((op) => op.sourceId === String(r._id))?.state ?? "pending", _id: String(r._id), productId: String(r.productId), variantId: r.variantId ? String(r.variantId) : null, locationId: r.locationId ? String(r.locationId) : null, image: products.find((product) => String(product._id) === String(r.productId))?.images?.[0] ?? null })),
    nextCursor: !paged && rows.length > input.limit ? String(rows[input.limit - 1]._id) : null,
    total: paged ? (total ?? 0) : undefined,
    page: paged ? input.page : undefined,
  };
}
/**
 * Stock rows the valuation returns. Its totals always cover every position;
 * the admin page asks for more rows than the default, which the business app
 * keeps.
 */
export async function inventoryValuationReport(input: InventoryReportScope & { positionLimit?: number }) {
  const positionLimit = input.positionLimit ?? 200;
  const scope = await inventoryMovementScope(input);
  const scoped = Boolean(input.productId || input.variantId || input.locationId || input.locationIds?.length || (input.productFilter && Object.keys(input.productFilter).length));
  const saleIssues = await inventorySaleCoverage(input, scope.productId);
  const postingSourceIds = new Set(saleIssues.postingSourceIds);
  const [snapshots, movements, ledger, operations] = await Promise.all([
    InventoryMovement.aggregate<{ _id: string; last: { productId: unknown; variantId?: unknown; locationId?: unknown; valueAfter: number; quantityAfter: number; physicalAvailableAfter?: number | null; unitCost: number | null; missingCostQuantityAfter: number; statesAfter?: { inTransitOwned?: number; availableOwned?: number; reservedUncosted?: number; unavailableOwned?: number }; accountingAt: Date } }>([
      { $match: { ...scope, accountingAt: { $lte: input.asOf } } }, { $sort: { accountingAt: 1, _id: 1 } }, { $group: { _id: "$positionKey", last: { $last: "$$ROOT" } } },
    ]),
    InventoryMovement.find({ ...scope, accountingAt: { $lte: input.asOf } }).select("_id postings").lean(),
    LedgerEntry.find({ book: "own", currency: input.currency, date: { $lte: input.asOf }, $or: [{ debit: "inventory" }, { credit: "inventory" }] }).lean(),
    FinanceOperation.find({ state: { $in: ["pending", "conflict"] }, $or: [{ "postings.book": "own", "postings.currency": input.currency }, { action: /^inventory:/ }] }).lean(),
  ]);
  const movementIds = new Set(movements.map((m) => String(m._id)));
  const movementKeys = new Set(movements.flatMap((m) => (m.postings as LedgerPosting[]).map((p) => p.key)));
  const postedByKey = new Map(ledger.map((row) => [row.key, row]));
  const expectedKeys = new Set<string>();
  let pendingEffect = 0, pendingOperations = 0, conflicts = 0, pendingFunding = 0;
  const issues: Array<{ operationId: string; fingerprint: string; state: string; error?: string | null }> = [];
  for (const op of operations) {
    const rows = (op.postings as LedgerPosting[]).filter((p) => p.book === "own" && p.currency === input.currency && p.date <= input.asOf && (!scoped || movementIds.has(op.sourceId ?? "") || postingSourceIds.has(op.sourceId ?? "") || movementKeys.has(p.key)));
    if (!rows.length && !movementIds.has(op.sourceId ?? "") && !postingSourceIds.has(op.sourceId ?? "")) continue;
    let missing = 0;
    for (const row of rows) {
      if (expectedKeys.has(row.key)) continue;
      expectedKeys.add(row.key);
      const existing = postedByKey.get(row.key);
      const wanted = inventoryLedgerEffect([row], input.currency);
      const written = existing ? inventoryLedgerEffect([existing as LedgerPosting], input.currency) : 0;
      missing += wanted - written;
      if (row.source.kind === "expense") pendingFunding += wanted - written;
      if (existing && (existing.debit !== row.debit || existing.credit !== row.credit || existing.amount !== row.amount || String(existing.vendorId ?? "") !== String(row.vendorId ?? "") || existing.date.getTime() !== row.date.getTime() || existing.source.kind !== row.source.kind || String(existing.source.id) !== String(row.source.id))) conflicts++;
    }
    pendingEffect += missing;
    pendingOperations++;
    if (op.state === "conflict") conflicts++;
    issues.push({ operationId: String(op._id), fingerprint: op.fingerprint, state: op.state, error: op.error });
  }
  const fundingAllocations = await InventoryFundingAllocation.aggregate<{ total: number }>([
    { $match: { currency: input.currency, ...(scoped ? { movementId: { $in: movements.map((m) => m._id) } } : {}) } },
    { $lookup: { from: InventoryMovement.collection.name, localField: "movementId", foreignField: "_id", as: "movement" } },
    { $match: { "movement.accountingAt": { $lte: input.asOf } } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const allocatedFunding = fundingAllocations[0]?.total ?? 0;
  const postedFunding = inventoryLedgerEffect(ledger.filter((p) => p.source.kind === "expense") as LedgerPosting[], input.currency);
  const fundingAwaitingAllocation = scoped ? 0 : quantizeToCurrency(postedFunding + pendingFunding - allocatedFunding, input.currency);
  let postedValue = inventoryLedgerEffect((scoped ? ledger.filter((p) => movementKeys.has(p.key)) : ledger) as LedgerPosting[], input.currency);
  if (scoped) {
    // Adopted funding has no second inventory leg; include only each allocated share of its verified original leg.
    const adopted = await InventoryFundingAllocation.find({ movementId: { $in: movements.map((m) => m._id) }, currency: input.currency }).lean();
    for (const allocation of adopted) {
      if (movementKeys.has(allocation.fundingKey)) continue;
      const posted = postedByKey.get(allocation.fundingKey);
      const operation = operations.find((op) => (op.postings as LedgerPosting[]).some((p) => p.key === allocation.fundingKey && p.date <= input.asOf));
      const expected = (operation?.postings as LedgerPosting[] | undefined)?.find((p) => p.key === allocation.fundingKey);
      if (posted) postedValue += allocation.amount;
      else if (expected) pendingEffect += allocation.amount;
      else { conflicts++; continue; }
      if (operation && !issues.some((issue) => issue.operationId === String(operation._id))) {
        pendingOperations++;
        if (operation.state === "conflict") conflicts++;
        issues.push({ operationId: String(operation._id), fingerprint: operation.fingerprint, state: operation.state, error: operation.error });
      }
    }
  }
  const ownedValue = snapshots.reduce((sum, s) => sum + s.last.valueAfter, 0);
  const bookValue = quantizeToCurrency(ownedValue + fundingAwaitingAllocation, input.currency);
  const missingCostQuantity = snapshots.reduce((sum, s) => sum + (s.last.missingCostQuantityAfter ?? (s.last.unitCost == null ? s.last.quantityAfter : 0)), 0);
  const transitQuantity = snapshots.reduce((sum, s) => sum + (s.last.statesAfter?.inTransitOwned ?? 0), 0);
  // What the stock is and where its value sits, over every position as of the
  // date: the position list returned below stops at `positionLimit` rows.
  const stock = { units: 0, skus: new Set<string>(), locations: new Set<string>(), reservedValue: 0, heldValue: 0, transitValue: 0 };
  for (const { last } of snapshots) {
    const share = (units = 0) => Math.min(last.valueAfter, units * (last.unitCost ?? 0));
    stock.units += last.quantityAfter;
    if (last.quantityAfter > 0) { stock.skus.add(`${last.productId}:${last.variantId ?? ""}`); stock.locations.add(String(last.locationId ?? "")); }
    stock.reservedValue += share(last.statesAfter?.reservedUncosted);
    stock.heldValue += share(last.statesAfter?.unavailableOwned);
    stock.transitValue += share(last.statesAfter?.inTransitOwned);
  }
  const products = await Product.find({ vendorId: scope.ownerId, ...(scope.productId ? { _id: scope.productId } : {}), ...(input.productFilter ?? {}) }).select("name images updatedAt vendorId cost stock locationInventory inventoryFinanceGeneration inventoryFinanceCurrency inventory shipping variants._id variants.name variants.sku variants.cost variants.stock variants.locationInventory").lean();
  let availableValue = 0, availableQuantity = 0, legacyProducts = 0, negativeAvailableQuantity = 0;
  for (const product of products) {
    if (product.shipping?.isPhysicalProduct === false || product.inventory?.tracked === false) continue;
    if (product.inventoryFinanceGeneration !== 1) { legacyProducts++; continue; }
    if (product.inventoryFinanceCurrency !== input.currency) continue;
    for (const row of financialStockRows(product)) {
      if (input.variantId && row.variantId !== input.variantId) continue;
      if (input.locationId && row.locationId !== input.locationId) continue;
      if (input.locationIds?.length && (!row.locationId || !input.locationIds.includes(row.locationId))) continue;
      availableQuantity += Math.max(0, row.quantity);
      negativeAvailableQuantity += Math.max(0, -row.quantity);
      if (row.unitCost !== null) availableValue += Math.max(0, row.quantity) * row.unitCost;
    }
  }
  const reconciled = inventoryReconciliation({ currency: input.currency, bookValue, postedValue: quantizeToCurrency(postedValue, input.currency), pendingEffect: quantizeToCurrency(pendingEffect, input.currency), missingCostQuantity: missingCostQuantity + saleIssues.missingCostQuantity, deferredCostQuantity: saleIssues.deferredQuantity, pendingOperations, conflicts });
  const positions = await InventoryPosition.find(scope).sort({ productId: 1, variantId: 1, locationId: 1 }).limit(positionLimit).lean();
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const { postingSourceIds: _postingSourceIds, ...saleCoverage } = saleIssues;
  const locations = await InventoryLocation.find({ _id: { $in: positions.flatMap((p) => p.locationId ? [p.locationId] : []) } }).select("name").lean();
  const historicalAvailableValue = snapshots.reduce((sum, snapshot) => sum + Math.max(0, snapshot.last.physicalAvailableAfter ?? snapshot.last.statesAfter?.availableOwned ?? 0) * (snapshot.last.unitCost ?? 0), 0);
  return {
    ...reconciled, status: legacyProducts ? "migration_required" : negativeAvailableQuantity || saleIssues.currencyIssueQuantity ? "needs_review" : reconciled.status === "synced" && saleIssues.costSourceQuantity ? "cost_source_missing" : reconciled.status,
    asOf: input.asOf.toISOString(), basis: "fixed_cost", ownedBookValue: quantizeToCurrency(ownedValue, input.currency),
    fundingAwaitingAllocation, availableValue: inventoryMoney(availableValue, input.currency), availableQuantity, negativeAvailableQuantity,
    physicalAsOf: new Date().toISOString(), positionsAsOf: new Date().toISOString(), historicalAvailableValue: inventoryMoney(historicalAvailableValue, input.currency), transitQuantity, legacyProducts, issues, saleCoverage,
    stock: { units: stock.units, skus: stock.skus.size, locations: stock.locations.size, reservedValue: inventoryMoney(stock.reservedValue, input.currency), heldValue: inventoryMoney(stock.heldValue, input.currency), transitValue: inventoryMoney(stock.transitValue, input.currency) },
    positionLimit,
    positions: positions.map((p) => {
      const product = productById.get(String(p.productId));
      const row = product && financialStockRows(product).find((r) => r.variantId === (p.variantId ? String(p.variantId) : null) && r.locationId === (p.locationId ? String(p.locationId) : null));
      return { ...p, _id: String(p._id), productId: String(p.productId), productName: product?.name ?? "Product", image: product?.images?.[0] ?? null, sku: row?.sku ?? "", variantName: row?.variantName, locationName: locations.find((location) => String(location._id) === String(p.locationId))?.name, variantId: p.variantId ? String(p.variantId) : null, locationId: p.locationId ? String(p.locationId) : null };
    }),
  };
}

async function inventorySaleCoverage(input: InventoryReportScope, productFilter?: unknown) {
  const { InventoryCostSource } = await import("@/models/inventory-cost-source.model");
  const sources: Array<{ orderId: string; lineId: string; productName: string; quantity: number; estimate: number | null; currency: string }> = [];
  let costSourceQuantity = 0, currencyIssueQuantity = 0;
  const postingSourceIds: string[] = [];
  const orders = await Order.find({ "subOrders.items.inventoryFinanceGeneration": { $in: [1, 2] }, createdAt: { $lte: input.asOf }, ...(input.productId ? { "subOrders.items.productId": input.productId } : {}) }).select("inventoryReservationSourceId checkoutAttemptId paidAt createdAt orderNumber paymentStatus preorderOutstandingAmount subOrders._id subOrders.vendorId subOrders.paymentStatus subOrders.status subOrders.items currency").lean();
  const { isConsignmentCollectedForStock } = await import("@/lib/finance/postings");
  let deferredQuantity = 0, missingCostQuantity = 0, costedQuantity = 0;
  const scopedRemaining = new Map<string, number>();
  for (const order of orders) {

    for (const sub of order.subOrders ?? []) {
      if (!isConsignmentCollectedForStock(order, sub) || ["cancelled", "expired"].includes(sub.status ?? "")) continue;
      for (const item of sub.items ?? []) {
        if (!item.inventoryFinanceGeneration || (input.productId && String(item.productId) !== input.productId) || (input.variantId && String(item.variantId ?? "") !== input.variantId)) continue;
        if (productFilter && !(await Product.exists({ _id: item.productId, ...(input.productFilter ?? {}) }))) continue;
        let scopedPending: number | undefined;
        if (input.locationId || input.locationIds?.length) {
          if (item.inventoryFinanceGeneration === 2) continue;
          const { InventoryReservation } = await import("@/models/inventory-reservation.model");
          const ids = input.locationId ? [input.locationId] : input.locationIds!;
          const sources = [{ sourceKind: "order", sourceId: String(order._id) }, ...(order.inventoryReservationSourceId ? [{ sourceKind: "order_reservation", sourceId: order.inventoryReservationSourceId }] : []), ...(order.checkoutAttemptId ? [{ sourceKind: "checkout_attempt", sourceId: String(order.checkoutAttemptId) }] : [])];
          const remainingKey = `${order._id}:${sub.vendorId}:${item.productId}:${item.variantId ?? "main"}`;
          if (!scopedRemaining.has(remainingKey)) {
            const reservations = await InventoryReservation.find({ productId: item.productId, variantId: item.variantId ?? null, positionKey: { $regex: `:(${ids.join("|")}):` }, $or: sources, createdAt: { $lte: input.asOf } }).lean();
            if (!reservations.length) continue;
            scopedRemaining.set(remainingKey, reservations.reduce((sum, r) => sum + Math.max(0, r.requestedQuantity - r.claimedQuantity - r.releasedQuantity - r.cancelledUnbackedQuantity), 0));
          }
          scopedPending = Math.min(item.quantity, scopedRemaining.get(remainingKey)!);
          scopedRemaining.set(remainingKey, scopedRemaining.get(remainingKey)! - scopedPending);
        }
        const effectivePaidAt = sub.paidAt ?? order.paidAt ?? order.createdAt;
        if (effectivePaidAt && new Date(effectivePaidAt).getTime() > input.asOf.getTime()) continue;
        const product = await Product.findById(item.productId).select("name inventoryFinanceCurrency").lean();
        if (item.inventoryFinanceGeneration === 2) {
          if (order.currency !== input.currency) continue;
          const linked = await InventoryCostSource.find({ orderId: order._id, lineId: item.inventoryLineId, accountingAt: { $lte: input.asOf } }).lean();
          postingSourceIds.push(...linked.map((source) => String(source._id)));
          const remaining = Math.max(0, item.quantity - linked.reduce((sum, r) => sum + r.quantity, 0));
          if (remaining) sources.push({ orderId: String(order._id), lineId: item.inventoryLineId ?? "", productName: product?.name ?? "Nonphysical item", quantity: remaining, estimate: item.cost == null ? null : inventoryMoney(item.cost * remaining, input.currency), currency: input.currency });
          costSourceQuantity += remaining;
          continue;
        }
        if (product?.inventoryFinanceCurrency && product.inventoryFinanceCurrency !== order.currency) {
          if (product.inventoryFinanceCurrency === input.currency) currencyIssueQuantity += scopedPending ?? item.quantity;
          continue;
        }
        if (order.currency !== input.currency) continue;
        const recognized = await InventorySaleAllocation.aggregate<{ total: number }>([
          { $match: { orderId: order._id, subOrderId: sub._id, lineId: item.inventoryLineId, ...(scopeLocationFilter(input)) } },
          { $unwind: "$segments" },
          { $lookup: { from: InventoryMovement.collection.name, localField: "segments.movementId", foreignField: "_id", as: "movement" } },
          { $match: { "movement.accountingAt": { $lte: input.asOf } } },
          { $group: { _id: null, total: { $sum: "$segments.quantity" } } },
        ]);
        const recorded = Math.min(item.quantity, recognized[0]?.total ?? 0);
        costedQuantity += recorded;
        if (item.cost == null) missingCostQuantity += scopedPending ?? Math.max(0, item.quantity - recorded);
        else deferredQuantity += scopedPending ?? Math.max(0, item.quantity - recorded);
      }
    }
  }
  return { deferredQuantity, missingCostQuantity, costedQuantity, costSourceQuantity, currencyIssueQuantity, sources, postingSourceIds };
}

function scopeLocationFilter(input: InventoryReportScope) { const ids = input.locationId ? [input.locationId] : input.locationIds; return ids?.length ? { positionKey: { $regex: `:(${ids.join("|")}):` } } : {}; }
